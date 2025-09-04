import { Injectable } from '@nestjs/common';
import { FieldType, type IRecord } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { concatMap, lastValueFrom, map, range, toArray } from 'rxjs';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import { Timing } from '../../utils/timing';
import type { IFieldInstance, IFieldMap } from '../field/model/factory';
import { InjectRecordQueryBuilder, IRecordQueryBuilder } from '../record/query-builder';
import type { IFkRecordMap } from './link.service';
import { ReferenceService } from './reference.service';
import type { IGraphItem, ITopoItem } from './utils/dfs';
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
    private readonly prismaService: PrismaService,
    private readonly referenceService: ReferenceService,
    @InjectRecordQueryBuilder() private readonly recordQueryBuilder: IRecordQueryBuilder,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

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
    fields: IFieldInstance[],
    page: number,
    chunkSize: number
  ) {
    const { qb } = await this.recordQueryBuilder.createRecordQueryBuilder(dbTableName, {
      tableIdOrDbTableName: dbTableName,
      viewId: undefined,
    });
    const query = qb
      .where((builder) => {
        fields
          .filter((field) => !field.isComputed && field.type !== FieldType.Link)
          .forEach((field, index) => {
            const dbName = field.dbFieldName;
            if (index === 0) {
              builder.whereNotNull(dbName);
            } else {
              builder.orWhereNotNull(dbName);
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
      const totalPages = Math.ceil(rowCount / chunkSize);
      const fields = dbTableName2fields[dbTableName];

      const records = await lastValueFrom(
        range(0, totalPages).pipe(
          concatMap((page) => this.getRecordsByPage(dbTableName, fields, page, chunkSize)),
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

  @Timing()
  async getRowCount(dbTableName: string) {
    const query = this.knex.count('*', { as: 'count' }).from(dbTableName).toQuery();
    const [{ count }] = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ count: bigint }[]>(query);
    return Number(count);
  }

  // Legacy bulk recalculation helpers removed
}
