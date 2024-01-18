import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  ICreateRecordsRo,
  ICreateTableRo,
  ICreateTableWithDefault,
  IFieldRo,
  IFieldVo,
  IGetTableQuery,
  ITableFullVo,
  ITableVo,
  IViewRo,
} from '@teable-group/core';
import { FieldKeyType, FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { FieldCreatingService } from '../../field/field-calculate/field-creating.service';
import { FieldSupplementService } from '../../field/field-calculate/field-supplement.service';
import { createFieldInstanceByVo } from '../../field/model/factory';
import { GraphService } from '../../graph/graph.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { RecordService } from '../../record/record.service';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import { TableService } from '../table.service';

@Injectable()
export class TableOpenApiService {
  private logger = new Logger(TableOpenApiService.name);
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly graphService: GraphService,
    private readonly recordService: RecordService,
    private readonly tableService: TableService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldSupplementService: FieldSupplementService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async createView(tableId: string, viewRos: IViewRo[]) {
    const viewCreationPromises = viewRos.map(async (viewRo) => {
      return this.viewOpenApiService.createView(tableId, viewRo);
    });
    return await Promise.all(viewCreationPromises);
  }

  private async createField(tableId: string, fieldVos: IFieldVo[]) {
    const fieldSnapshots: IFieldVo[] = [];
    const fieldNameSet = new Set<string>();
    for (const fieldVo of fieldVos) {
      if (fieldNameSet.has(fieldVo.name)) {
        throw new BadRequestException(`duplicate field name: ${fieldVo.name}`);
      }
      fieldNameSet.add(fieldVo.name);
      const fieldInstance = createFieldInstanceByVo(fieldVo);
      await this.fieldCreatingService.alterCreateField(tableId, fieldInstance);
      fieldSnapshots.push(fieldVo);
    }
    return fieldSnapshots;
  }

  private async createRecords(tableId: string, data: ICreateRecordsRo) {
    return this.recordOpenApiService.createRecords(tableId, data.records, data.fieldKeyType);
  }

  private async prepareFields(tableId: string, fieldRos: IFieldRo[]) {
    const fields: IFieldVo[] = [];
    const simpleFields: IFieldRo[] = [];
    const computeFields: IFieldRo[] = [];
    fieldRos.forEach((field) => {
      if (field.type === FieldType.Link || field.type === FieldType.Formula || field.isLookup) {
        computeFields.push(field);
      } else {
        simpleFields.push(field);
      }
    });

    for (const fieldRo of simpleFields) {
      fields.push(await this.fieldSupplementService.prepareCreateField(tableId, fieldRo));
    }

    const allFieldRos = simpleFields.concat(computeFields);
    for (const fieldRo of computeFields) {
      fields.push(
        await this.fieldSupplementService.prepareCreateField(
          tableId,
          fieldRo,
          allFieldRos.filter((ro) => ro !== fieldRo) as IFieldVo[]
        )
      );
    }
    return fields;
  }

  async createTable(baseId: string, tableRo: ICreateTableWithDefault): Promise<ITableFullVo> {
    const schema = await this.prismaService.$tx(async () => {
      const tableVo = await this.createTableMeta(baseId, tableRo);
      const tableId = tableVo.id;
      const preparedFields = await this.prepareFields(tableId, tableRo.fields);
      const fieldVos = await this.createField(tableId, preparedFields);
      const viewVos = await this.createView(tableId, tableRo.views);

      return {
        ...tableVo,
        total: tableRo.records?.length || 0,
        fields: fieldVos,
        views: viewVos,
        defaultViewId: viewVos[0].id,
      };
    });

    const records = await this.prismaService.$tx(async () => {
      const recordsVo =
        tableRo.records?.length &&
        (await this.createRecords(schema.id, {
          records: tableRo.records,
          fieldKeyType: tableRo.fieldKeyType ?? FieldKeyType.Name,
        }));

      return recordsVo ? recordsVo.records : [];
    });

    return {
      ...schema,
      records,
    };
  }

  async createTableMeta(baseId: string, tableRo: ICreateTableRo) {
    return await this.tableService.createTable(baseId, tableRo);
  }

  async getTable(baseId: string, tableId: string, query: IGetTableQuery): Promise<ITableVo> {
    const { viewId, fieldKeyType, includeContent } = query;
    if (includeContent) {
      return await this.tableService.getFullTable(baseId, tableId, viewId, fieldKeyType);
    }
    return await this.tableService.getTableMeta(baseId, tableId);
  }

  async getTables(baseId: string): Promise<ITableVo[]> {
    const tablesMeta = await this.prismaService.txClient().tableMeta.findMany({
      orderBy: { order: 'asc' },
      where: { baseId, deletedTime: null },
    });
    const tableIds = tablesMeta.map((tableMeta) => tableMeta.id);
    const tableTime = await this.tableService.getTableLastModifiedTime(tableIds);
    const tableDefaultViewIds = await this.tableService.getTableDefaultViewId(tableIds);
    return tablesMeta.map((tableMeta, i) => {
      const time = tableTime[i];
      const defaultViewId = tableDefaultViewIds[i];
      if (!defaultViewId) {
        throw new Error('defaultViewId is not found');
      }
      return {
        ...tableMeta,
        description: tableMeta.description ?? undefined,
        icon: tableMeta.icon ?? undefined,
        lastModifiedTime: time || tableMeta.lastModifiedTime.toISOString(),
        defaultViewId,
      };
    });
  }

  async deleteTable(baseId: string, tableId: string, arbitrary = false) {
    return await this.prismaService.$tx(
      async (prisma) => {
        const { dbTableName } = await this.prismaService.tableMeta.findFirstOrThrow({
          where: { id: tableId, deletedTime: null },
          select: { dbTableName: true },
        });

        await this.tableService.deleteTable(baseId, tableId);

        // delete field for table
        await prisma.field.deleteMany({
          where: { tableId },
        });

        // delete view for table
        await prisma.view.deleteMany({
          where: { tableId },
        });

        // clear ops for view/field/record
        await prisma.ops.deleteMany({
          where: { collection: tableId },
        });

        // clean ops for table
        await prisma.ops.deleteMany({
          where: { docId: tableId },
        });
        if (arbitrary) {
          await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${dbTableName}`);
        }
      },
      {
        timeout: 100_000,
      }
    );
  }

  async sqlQuery(tableId: string, viewId: string, sql: string) {
    this.logger.log('sqlQuery:sql: ' + sql);
    const { queryBuilder } = await this.recordService.buildFilterSortQuery(tableId, {
      viewId,
    });

    const baseQuery = queryBuilder.toString();
    const { dbTableName } = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });

    const combinedQuery = `
      WITH base AS (${baseQuery})
      ${sql.replace(dbTableName, 'base')};
    `;
    this.logger.log('sqlQuery:sql:combine: ' + combinedQuery);

    return this.prismaService.$queryRawUnsafe(combinedQuery);
  }

  async getGraph(tableId: string, cell: [string, string]) {
    return this.graphService.getGraph(tableId, cell);
  }
}
