import {
  BadRequestException,
  NotFoundException,
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import type {
  FieldAction,
  IFieldRo,
  IFieldVo,
  ILinkFieldOptions,
  ILookupOptionsVo,
  IViewRo,
  RecordAction,
  IRole,
  TableAction,
  ViewAction,
} from '@teable/core';
import {
  ActionPrefix,
  FieldKeyType,
  FieldType,
  actionPrefixMap,
  getBasePermission,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  ResourceType,
  type ICreateRecordsRo,
  type ICreateTableRo,
  type ICreateTableWithDefault,
  type ITableFullVo,
  type ITablePermissionVo,
  type ITableVo,
  type IUpdateOrderRo,
} from '@teable/openapi';
import { nanoid } from 'nanoid';
import { ThresholdConfig, IThresholdConfig } from '../../../configs/threshold.config';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { updateOrder } from '../../../utils/update-order';
import { PermissionService } from '../../auth/permission.service';
import { LinkService } from '../../calculation/link.service';
import { FieldCreatingService } from '../../field/field-calculate/field-creating.service';
import { FieldSupplementService } from '../../field/field-calculate/field-supplement.service';
import { createFieldInstanceByVo } from '../../field/model/factory';
import { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
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
    private readonly recordService: RecordService,
    private readonly tableService: TableService,
    private readonly linkService: LinkService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly permissionService: PermissionService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
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
    return this.recordOpenApiService.createRecords(tableId, data);
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

    const repeatedDbFieldNames = fields
      .map((f) => f.dbFieldName)
      .filter((value, index, self) => self.indexOf(value) !== index);

    // generator dbFieldName may repeat, this is fix it.
    return fields.map((f) => {
      const newField = { ...f };
      const { dbFieldName } = newField;

      if (repeatedDbFieldNames.includes(dbFieldName)) {
        newField.dbFieldName = `${dbFieldName}_${nanoid(3)}`;
      }

      return newField;
    });
  }

  async createTable(baseId: string, tableRo: ICreateTableWithDefault): Promise<ITableFullVo> {
    const schema = await this.prismaService.$tx(async () => {
      const tableVo = await this.createTableMeta(baseId, tableRo);
      const tableId = tableVo.id;
      const preparedFields = await this.prepareFields(tableId, tableRo.fields);
      // create teable should not set computed field isPending, because noting need to calculate when create
      preparedFields.forEach((field) => delete field.isPending);
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

  async getTable(baseId: string, tableId: string): Promise<ITableVo> {
    return await this.tableService.getTableMeta(baseId, tableId);
  }

  async getTables(baseId: string, includeTableIds?: string[]): Promise<ITableVo[]> {
    const tablesMeta = await this.prismaService.txClient().tableMeta.findMany({
      orderBy: { order: 'asc' },
      where: {
        baseId,
        deletedTime: null,
        id: includeTableIds ? { in: includeTableIds } : undefined,
      },
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
        lastModifiedTime: time || tableMeta.lastModifiedTime?.toISOString(),
        defaultViewId,
      };
    });
  }

  async detachLink(tableId: string) {
    // handle the link field in this table
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: { tableId, type: FieldType.Link, isLookup: null, deletedTime: null },
      select: { id: true, options: true },
    });

    for (const field of linkFields) {
      if (field.options) {
        const options = JSON.parse(field.options as string) as ILinkFieldOptions;
        // if the link field is a self-link field, skip it
        if (options.foreignTableId === tableId) {
          continue;
        }
      }
      await this.fieldOpenApiService.convertField(tableId, field.id, {
        type: FieldType.SingleLineText,
      });
    }

    // handle the link field in related tables
    const relatedLinkFieldRaws = await this.linkService.getRelatedLinkFieldRaws(tableId);

    for (const field of relatedLinkFieldRaws) {
      if (field.tableId === tableId) {
        continue;
      }
      await this.fieldOpenApiService.convertField(field.tableId, field.id, {
        type: FieldType.SingleLineText,
      });
    }
  }

  async permanentDeleteTables(baseId: string, tableIds: string[]) {
    // If the table has already been deleted, exceptions may occur
    // If the table hasn't been deleted and permanent deletion is executed directly,
    // we need to handle the deletion of associated data
    try {
      for (const tableId of tableIds) {
        await this.detachLink(tableId);
      }
    } catch (e) {
      console.log('Permanent delete tables error:', e);
    }

    return await this.prismaService.$tx(
      async () => {
        await this.dropTables(tableIds);
        await this.cleanTablesRelatedData(baseId, tableIds);
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async dropTables(tableIds: string[]) {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { dbTableName: true },
    });

    for (const table of tables) {
      await this.prismaService
        .txClient()
        .$executeRawUnsafe(this.dbProvider.dropTable(table.dbTableName));
    }
  }

  async cleanReferenceFieldIds(tableIds: string[]) {
    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId: { in: tableIds }, type: { in: [FieldType.Link, FieldType.Formula] } },
      select: { id: true },
    });
    const fieldIds = fields.map((field) => field.id);
    await this.prismaService.txClient().reference.deleteMany({
      where: { OR: [{ fromFieldId: { in: fieldIds } }, { toFieldId: { in: fieldIds } }] },
    });
  }

  async cleanTablesRelatedData(baseId: string, tableIds: string[]) {
    // delete field for table
    await this.prismaService.txClient().field.deleteMany({
      where: { tableId: { in: tableIds } },
    });

    // delete view for table
    await this.prismaService.txClient().view.deleteMany({
      where: { tableId: { in: tableIds } },
    });

    // clean attachment for table
    await this.prismaService.txClient().attachmentsTable.deleteMany({
      where: { tableId: { in: tableIds } },
    });

    // clear ops for view/field/record
    await this.prismaService.txClient().ops.deleteMany({
      where: { collection: { in: tableIds } },
    });

    // clean ops for table
    await this.prismaService.txClient().ops.deleteMany({
      where: { collection: baseId, docId: { in: tableIds } },
    });

    await this.prismaService.txClient().tableMeta.deleteMany({
      where: { id: { in: tableIds } },
    });

    // clean record history for table
    await this.prismaService.txClient().recordHistory.deleteMany({
      where: { tableId: { in: tableIds } },
    });

    // clean trash for table
    await this.prismaService.txClient().trash.deleteMany({
      where: { resourceId: { in: tableIds }, resourceType: ResourceType.Table },
    });
  }

  async deleteTable(baseId: string, tableId: string) {
    try {
      await this.detachLink(tableId);
    } catch (e) {
      console.log(`Detach link error in table ${tableId}:`, e);
    }

    return await this.prismaService.$tx(
      async (prisma) => {
        const deletedTime = new Date();

        await this.tableService.deleteTable(baseId, tableId, deletedTime);

        await prisma.field.updateMany({
          where: { tableId, deletedTime: null },
          data: { deletedTime },
        });

        await prisma.view.updateMany({
          where: { tableId, deletedTime: null },
          data: { deletedTime },
        });
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async restoreTable(baseId: string, tableId: string) {
    return await this.prismaService.$tx(
      async (prisma) => {
        const { deletedTime } = await prisma.trash.findFirstOrThrow({
          where: { resourceId: tableId, resourceType: ResourceType.Table },
        });

        if (!deletedTime) {
          throw new ForbiddenException(
            'Unable to restore this table because it is not in the trash'
          );
        }

        await this.tableService.restoreTable(baseId, tableId);

        await prisma.field.updateMany({
          where: { tableId, deletedTime },
          data: { deletedTime: null },
        });

        await prisma.view.updateMany({
          where: { tableId, deletedTime },
          data: { deletedTime: null },
        });

        await prisma.trash.deleteMany({
          where: { resourceId: tableId },
        });
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
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

  async updateName(baseId: string, tableId: string, name: string) {
    await this.prismaService.$tx(async () => {
      await this.tableService.updateTable(baseId, tableId, { name });
    });
  }

  async updateIcon(baseId: string, tableId: string, icon: string) {
    await this.prismaService.$tx(async () => {
      await this.tableService.updateTable(baseId, tableId, { icon });
    });
  }

  async updateDescription(baseId: string, tableId: string, description: string | null) {
    await this.prismaService.$tx(async () => {
      await this.tableService.updateTable(baseId, tableId, { description });
    });
  }

  async updateDbTableName(baseId: string, tableId: string, dbTableNameRo: string) {
    const dbTableName = this.dbProvider.joinDbTableName(baseId, dbTableNameRo);
    const existDbTableName = await this.prismaService.tableMeta
      .findFirst({
        where: { baseId, dbTableName, deletedTime: null },
        select: { id: true },
      })
      .catch(() => {
        throw new NotFoundException(`table ${tableId} not found`);
      });

    if (existDbTableName) {
      throw new BadRequestException(`dbTableName ${dbTableNameRo} already exists`);
    }

    const { dbTableName: oldDbTableName } = await this.prismaService.tableMeta
      .findFirstOrThrow({
        where: { id: tableId, baseId, deletedTime: null },
        select: { dbTableName: true },
      })
      .catch(() => {
        throw new NotFoundException(`table ${tableId} not found`);
      });

    const linkFieldsRaw = await this.prismaService.field.findMany({
      where: { table: { baseId }, type: FieldType.Link },
      select: { id: true, options: true },
    });

    const relationalFieldsRaw = await this.prismaService.field.findMany({
      where: { table: { baseId }, lookupOptions: { not: null } },
      select: { id: true, lookupOptions: true },
    });

    await this.prismaService.$tx(async (prisma) => {
      await Promise.all(
        linkFieldsRaw
          .map((field) => ({
            ...field,
            options: JSON.parse(field.options as string) as ILinkFieldOptions,
          }))
          .filter((field) => {
            return field.options.fkHostTableName === oldDbTableName;
          })
          .map((field) => {
            return prisma.field.update({
              where: { id: field.id },
              data: { options: JSON.stringify({ ...field.options, fkHostTableName: dbTableName }) },
            });
          })
      );

      await Promise.all(
        relationalFieldsRaw
          .map((field) => ({
            ...field,
            lookupOptions: JSON.parse(field.lookupOptions as string) as ILookupOptionsVo,
          }))
          .filter((field) => {
            return field.lookupOptions.fkHostTableName === oldDbTableName;
          })
          .map((field) => {
            return prisma.field.update({
              where: { id: field.id },
              data: {
                lookupOptions: JSON.stringify({
                  ...field.lookupOptions,
                  fkHostTableName: dbTableName,
                }),
              },
            });
          })
      );

      await this.tableService.updateTable(baseId, tableId, { dbTableName });
      const renameSql = this.dbProvider.renameTableName(oldDbTableName, dbTableName);
      for (const sql of renameSql) {
        await prisma.$executeRawUnsafe(sql);
      }
    });
  }

  async shuffle(baseId: string) {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    this.logger.log(`lucky table shuffle! ${baseId}`, 'shuffle');

    await this.prismaService.$tx(async () => {
      for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        await this.tableService.updateTable(baseId, table.id, { order: i });
      }
    });
  }

  async updateOrder(baseId: string, tableId: string, orderRo: IUpdateOrderRo) {
    const { anchorId, position } = orderRo;

    const table = await this.prismaService.tableMeta
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { baseId, id: tableId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Table ${tableId} not found`);
      });

    const anchorTable = await this.prismaService.tableMeta
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { baseId, id: anchorId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Anchor ${anchorId} not found`);
      });

    await updateOrder({
      query: baseId,
      position,
      item: table,
      anchorItem: anchorTable,
      getNextItem: async (whereOrder, align) => {
        return this.prismaService.tableMeta.findFirst({
          select: { order: true, id: true },
          where: {
            baseId,
            deletedTime: null,
            order: whereOrder,
          },
          orderBy: { order: align },
        });
      },
      update: async (
        parentId: string,
        id: string,
        data: { newOrder: number; oldOrder: number }
      ) => {
        await this.prismaService.$tx(async () => {
          await this.tableService.updateTable(parentId, id, { order: data.newOrder });
        });
      },
      shuffle: this.shuffle.bind(this),
    });
  }

  async getPermission(baseId: string, tableId: string): Promise<ITablePermissionVo> {
    let role: IRole | null = await this.permissionService.getRoleByBaseId(baseId);
    if (!role) {
      const { spaceId } = await this.permissionService.getUpperIdByBaseId(baseId);
      role = await this.permissionService.getRoleBySpaceId(spaceId);
    }
    if (!role) {
      throw new NotFoundException(`Role not found`);
    }
    return this.getPermissionByRole(tableId, role);
  }

  async getPermissionByRole(tableId: string, role: IRole) {
    const permissionMap = getBasePermission(role);
    const tablePermission = actionPrefixMap[ActionPrefix.Table].reduce(
      (acc, action) => {
        acc[action] = permissionMap[action];
        return acc;
      },
      {} as Record<TableAction, boolean>
    );
    const viewPermission = actionPrefixMap[ActionPrefix.View].reduce(
      (acc, action) => {
        acc[action] = permissionMap[action];
        return acc;
      },
      {} as Record<ViewAction, boolean>
    );

    const recordPermission = actionPrefixMap[ActionPrefix.Record].reduce(
      (acc, action) => {
        acc[action] = permissionMap[action];
        return acc;
      },
      {} as Record<RecordAction, boolean>
    );

    const fields = await this.prismaService.field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
    });

    const excludeFieldCreate = actionPrefixMap[ActionPrefix.Field].filter(
      (action) => action !== 'field|create'
    );
    const fieldPermission = fields.reduce(
      (acc, field) => {
        acc[field.id] = excludeFieldCreate.reduce(
          (acc, action) => {
            acc[action] = permissionMap[action];
            return acc;
          },
          {} as Record<FieldAction, boolean>
        );
        return acc;
      },
      {} as Record<string, Record<FieldAction, boolean>>
    );

    return {
      table: tablePermission,
      field: {
        fields: fieldPermission,
        create: permissionMap['field|create'],
      },
      record: recordPermission,
      view: viewPermission,
    };
  }
}
