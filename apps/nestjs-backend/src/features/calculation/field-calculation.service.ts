import { Injectable } from '@nestjs/common';
import { type IRecord } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { keyBy, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { concatMap, lastValueFrom, map, range, toArray } from 'rxjs';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import { Timing } from '../../utils/timing';
import { systemDbFieldNames } from '../field/constant';
import type { IFieldInstance, IFieldMap } from '../field/model/factory';
import { BatchService } from './batch.service';
import type { IFkRecordMap } from './link.service';
import type { IGraphItem, ITopoItem } from './reference.service';
import { ReferenceService } from './reference.service';
import { getTopoOrders, prependStartFieldIds } from './utils/dfs';

// eslint-disable-next-line @typescript-eslint/no-unused-vars

export interface ITopoOrdersContext {
  fieldMap: IFieldMap;
  allFieldIds: string[];
  startFieldIds: string[];
  directedGraph: IGraphItem[];
  fieldId2DbTableName: { [fieldId: string]: string };
  topoOrders: ITopoItem[];
  tableId2DbTableName: { [tableId: string]: string };
  dbTableName2fields: { [dbTableName: string]: IFieldInstance[] };
  fieldId2TableId: { [fieldId: string]: string };
  fkRecordMap?: IFkRecordMap;
}

@Injectable()
export class FieldCalculationService {
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly referenceService: ReferenceService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async getUserMap(tableId: string) {
    const {
      baseId,
      base: { spaceId },
    } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: {
        baseId: true,
        base: { select: { spaceId: true } },
      },
    });

    const collaborators = await this.prismaService.collaborator.findMany({
      where: { resourceId: { in: [spaceId, baseId] } },
      select: { userId: true },
    });

    const users = await this.prismaService.user.findMany({
      where: { id: { in: collaborators.map((c) => c.userId) } },
      select: { id: true, name: true, avatar: true },
    });

    return keyBy(users, 'id');
  }

  async getTopoOrdersContext(
    fieldIds: string[],
    customGraph?: IGraphItem[]
  ): Promise<ITopoOrdersContext> {
    const directedGraph = customGraph || (await this.referenceService.getFieldGraphItems(fieldIds));

    // get all related field by undirected graph
    const allFieldIds = uniq(this.referenceService.flatGraph(directedGraph).concat(fieldIds));

    // prepare all related data
    const {
      fieldMap,
      fieldId2TableId,
      dbTableName2fields,
      fieldId2DbTableName,
      tableId2DbTableName,
    } = await this.referenceService.createAuxiliaryData(allFieldIds);

    // topological sorting
    const topoOrders = prependStartFieldIds(getTopoOrders(directedGraph), fieldIds);

    return {
      startFieldIds: fieldIds,
      allFieldIds,
      fieldMap,
      directedGraph,
      topoOrders,
      tableId2DbTableName,
      fieldId2DbTableName,
      dbTableName2fields,
      fieldId2TableId,
    };
  }

  private async getRecordsByPage(
    dbTableName: string,
    dbFieldNames: string[],
    page: number,
    chunkSize: number
  ) {
    const query = this.knex(dbTableName)
      .select([...dbFieldNames, ...systemDbFieldNames])
      .where((builder) => {
        dbFieldNames.forEach((fieldNames, index) => {
          if (index === 0) {
            builder.whereNotNull(fieldNames);
          } else {
            builder.orWhereNotNull(fieldNames);
          }
        });
      })
      .orderBy('__auto_number')
      .limit(chunkSize)
      .offset(page * chunkSize)
      .toQuery();
    return this.prismaService
      .txClient()
      .$queryRawUnsafe<{ [dbFieldName: string]: unknown }[]>(query);
  }

  async getRecordsBatchByFields(dbTableName2fields: { [dbTableName: string]: IFieldInstance[] }) {
    const results: {
      [dbTableName: string]: IRecord[];
    } = {};
    const chunkSize = this.thresholdConfig.calcChunkSize;
    for (const dbTableName in dbTableName2fields) {
      // deduplication is needed
      const rowCount = await this.getRowCount(dbTableName);
      const dbFieldNames = dbTableName2fields[dbTableName].map((f) => f.dbFieldName);
      const totalPages = Math.ceil(rowCount / chunkSize);
      const fields = dbTableName2fields[dbTableName];

      const records = await lastValueFrom(
        range(0, totalPages).pipe(
          concatMap((page) => this.getRecordsByPage(dbTableName, dbFieldNames, page, chunkSize)),
          toArray(),
          map((records) => records.flat())
        )
      );

      results[dbTableName] = records.map((record) =>
        this.referenceService.recordRaw2Record(fields, record)
      );
    }
    return results;
  }

  async calculateFields(tableId: string, fieldIds: string[], recordIds?: string[]) {
    if (!fieldIds.length) {
      return undefined;
    }

    const context = await this.getTopoOrdersContext(fieldIds);
    await this.calculateChanges(tableId, context, recordIds);
  }

  @Timing()
  async getRowCount(dbTableName: string) {
    const query = this.knex.count('*', { as: 'count' }).from(dbTableName).toQuery();
    const [{ count }] = await this.prismaService.$queryRawUnsafe<{ count: bigint }[]>(query);
    return Number(count);
  }

  private async getRecordIds(dbTableName: string, page: number, chunkSize: number) {
    const query = this.knex(dbTableName)
      .select({ id: '__id' })
      .orderBy('__auto_number')
      .limit(chunkSize)
      .offset(page * chunkSize)
      .toQuery();
    const result = await this.prismaService.$queryRawUnsafe<{ id: string }[]>(query);
    return result.map((item) => item.id);
  }

  @Timing()
  private async calculateChanges(
    tableId: string,
    context: ITopoOrdersContext,
    recordIds?: string[]
  ) {
    const dbTableName = context.tableId2DbTableName[tableId];
    const chunkSize = this.thresholdConfig.calcChunkSize;
    const fieldIds = context.startFieldIds;
    const taskFunction = async (ids: string[]) =>
      this.referenceService.calculate({
        ...context,
        startZone: Object.fromEntries(fieldIds.map((fieldId) => [fieldId, ids])),
      });

    if (recordIds && recordIds.length > 0) {
      await taskFunction(recordIds);
      return;
    }

    const rowCount = await this.getRowCount(dbTableName);
    const totalPages = Math.ceil(rowCount / chunkSize);

    for (let page = 0; page < totalPages; page++) {
      const ids = await this.getRecordIds(dbTableName, page, chunkSize);
      await taskFunction(ids);
    }
  }

  async calComputedFieldsByRecordIds(tableId: string, recordIds: string[]) {
    const fieldRaws = await this.prismaService.field.findMany({
      where: { tableId, isComputed: true, deletedTime: null, hasError: null },
      select: { id: true },
    });

    const computedFieldIds = fieldRaws.map((fieldRaw) => fieldRaw.id);

    // calculate by origin ops and link derivation
    const result = await this.calculateFields(tableId, computedFieldIds, recordIds);

    if (result) {
      const { opsMap, fieldMap, tableId2DbTableName } = result;

      await this.batchService.updateRecords(opsMap, fieldMap, tableId2DbTableName);
    }
  }
}
