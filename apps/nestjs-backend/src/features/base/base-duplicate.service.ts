import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import {
  FieldType,
  generateBaseId,
  generateFieldId,
  generateTableId,
  generateViewId,
} from '@teable/core';
import type { Field } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateBaseVo, IDuplicateBaseRo } from '@teable/openapi';
import { Knex } from 'knex';
import { uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import { replaceExpressionFieldIds, replaceJsonStringFieldIds } from './utils';

@Injectable()
export class BaseDuplicateService {
  private logger = new Logger(BaseDuplicateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  private async getMaxOrder(spaceId: string) {
    const spaceAggregate = await this.prismaService.txClient().base.aggregate({
      where: { spaceId, deletedTime: null },
      _max: { order: true },
    });
    return spaceAggregate._max.order || 0;
  }

  private async duplicateBaseMeta(duplicateBaseRo: IDuplicateBaseRo) {
    const { spaceId, fromBaseId, name } = duplicateBaseRo;
    const base = await this.prismaService.txClient().base.findFirst({
      where: {
        id: fromBaseId,
        deletedTime: null,
      },
    });
    if (!base) {
      throw new NotFoundException('Base not found');
    }
    const userId = this.cls.get('user.id');
    const toBaseId = generateBaseId();
    return await this.prismaService.txClient().base.create({
      data: {
        id: toBaseId,
        name: name ? name : base.name,
        icon: base.icon,
        order: (await this.getMaxOrder(spaceId)) + 1,
        spaceId: spaceId,
        createdBy: userId,
      },
      select: {
        id: true,
        name: true,
        icon: true,
        spaceId: true,
        order: true,
      },
    });
  }

  private async duplicateTableMeta(fromBaseId: string, toBaseId: string) {
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: {
        baseId: fromBaseId,
        deletedTime: null,
      },
    });
    const userId = this.cls.get('user.id');
    const old2NewTableIdMap: Record<string, string> = {};
    for (const table of tables) {
      const newTableId = generateTableId();
      old2NewTableIdMap[table.id] = newTableId;
      await this.prismaService.txClient().tableMeta.create({
        data: {
          ...table,
          id: newTableId,
          dbTableName: this.replaceDbTableName(table.dbTableName, toBaseId),
          baseId: toBaseId,
          version: 1,
          createdTime: new Date(),
          lastModifiedTime: new Date(),
          createdBy: userId,
          lastModifiedBy: userId,
        },
      });
    }
    return old2NewTableIdMap;
  }

  private replaceDbTableName(dbTableName: string, toBaseId: string) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, tableName] = this.dbProvider.splitTableName(dbTableName);
    return this.dbProvider.joinDbTableName(toBaseId, tableName);
  }

  private reBuildFieldRaw(
    toBaseId: string,
    field: IFieldInstance,
    fieldRaw: Field,
    old2NewTableIdMap: Record<string, string>,
    old2NewFieldIdMap: Record<string, string>
  ) {
    const userId = this.cls.get('user.id');
    const newFieldRaw: Field = {
      ...fieldRaw,
      id: old2NewFieldIdMap[field.id],
      tableId: old2NewTableIdMap[fieldRaw.tableId],
      version: 1,
      createdTime: new Date(),
      lastModifiedTime: new Date(),
      createdBy: userId,
      lastModifiedBy: userId,
    };

    if (field.lookupOptions) {
      newFieldRaw.lookupOptions = JSON.stringify({
        ...field.lookupOptions,
        foreignTableId: old2NewTableIdMap[field.lookupOptions.foreignTableId],
        lookupFieldId: old2NewFieldIdMap[field.lookupOptions.lookupFieldId],
        linkFieldId: old2NewFieldIdMap[field.lookupOptions.linkFieldId],
        fkHostTableName: this.replaceDbTableName(field.lookupOptions.fkHostTableName, toBaseId),
      });
    }

    if (field.type === FieldType.Link) {
      newFieldRaw.options = JSON.stringify({
        ...field.options,
        foreignTableId: old2NewTableIdMap[field.options.foreignTableId],
        lookupFieldId: old2NewFieldIdMap[field.options.lookupFieldId],
        symmetricFieldId: field.options.symmetricFieldId
          ? old2NewFieldIdMap[field.options.symmetricFieldId]
          : undefined,
        fkHostTableName: this.replaceDbTableName(field.options.fkHostTableName, toBaseId),
      });
    }

    if (field.type === FieldType.Formula || field.type === FieldType.Rollup) {
      newFieldRaw.options = JSON.stringify({
        ...field.options,
        expression: replaceExpressionFieldIds(field.options.expression, old2NewFieldIdMap),
      });
    }

    if (fieldRaw.lookupLinkedFieldId) {
      newFieldRaw.lookupLinkedFieldId = old2NewFieldIdMap[fieldRaw.lookupLinkedFieldId];
    }

    return newFieldRaw;
  }

  private async duplicateFields(toBaseId: string, old2NewTableIdMap: Record<string, string>) {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: { in: Object.keys(old2NewTableIdMap) },
        deletedTime: null,
      },
    });
    const old2NewFieldIdMap = fieldRaws.reduce<Record<string, string>>((acc, fieldRaw) => {
      acc[fieldRaw.id] = generateFieldId();
      return acc;
    }, {});

    for (const fieldRaw of fieldRaws) {
      const field = createFieldInstanceByRaw(fieldRaw);

      const newFieldRaw = this.reBuildFieldRaw(
        toBaseId,
        field,
        fieldRaw,
        old2NewTableIdMap,
        old2NewFieldIdMap
      );

      await this.prismaService.txClient().field.create({
        data: newFieldRaw,
      });
    }

    return old2NewFieldIdMap;
  }

  private async duplicateViews(
    old2NewTableIdMap: Record<string, string>,
    old2NewFieldIdMap: Record<string, string>
  ) {
    const viewRaws = await this.prismaService.txClient().view.findMany({
      where: {
        tableId: { in: Object.keys(old2NewTableIdMap) },
        deletedTime: null,
      },
    });

    const userId = this.cls.get('user.id');
    const old2NewViewIdMap: Record<string, string> = {};
    for (const viewRaw of viewRaws) {
      const newViewId = generateViewId();
      old2NewViewIdMap[viewRaw.id] = newViewId;
      const newView = {
        ...viewRaw,
        id: newViewId,
        tableId: old2NewTableIdMap[viewRaw.tableId],
        version: 1,
        createdTime: new Date(),
        createdBy: userId,
        options: replaceJsonStringFieldIds(viewRaw.options, old2NewFieldIdMap),
        sort: replaceJsonStringFieldIds(viewRaw.sort, old2NewFieldIdMap),
        filter: replaceJsonStringFieldIds(viewRaw.filter, old2NewFieldIdMap),
        group: replaceJsonStringFieldIds(viewRaw.group, old2NewFieldIdMap),
        columnMeta: replaceJsonStringFieldIds(viewRaw.columnMeta, old2NewFieldIdMap) || '',
        enableShare: undefined,
        shareId: undefined,
        shareMeta: undefined,
      };
      await this.prismaService.txClient().view.create({ data: newView });
    }
    return old2NewViewIdMap;
  }

  private async duplicateReferences(old2NewFieldIdMap: Record<string, string>) {
    const allFieldIds = Object.keys(old2NewFieldIdMap);
    const references = await this.prismaService.txClient().reference.findMany({
      where: { OR: [{ fromFieldId: { in: allFieldIds } }, { toFieldId: { in: allFieldIds } }] },
      select: { fromFieldId: true, toFieldId: true },
    });

    for (const { fromFieldId, toFieldId } of references) {
      await this.prismaService.txClient().reference.create({
        data: {
          fromFieldId: old2NewFieldIdMap[fromFieldId],
          toFieldId: old2NewFieldIdMap[toFieldId],
        },
      });
    }
  }

  private async createSchema(baseId: string) {
    const sqlList = this.dbProvider.createSchema(baseId);
    if (sqlList) {
      for (const sql of sqlList) {
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }
    }
  }

  private async renameViewIndexes(dbTableName: string, old2NewViewIdMap: Record<string, string>) {
    const columnInfoQuery = this.dbProvider.columnInfo(dbTableName);
    const columns = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);
    const viewIndexColumns = columns.filter((column) =>
      column.name.startsWith(ROW_ORDER_FIELD_PREFIX)
    );

    for (const { name } of viewIndexColumns) {
      const oldViewId = name.substring(ROW_ORDER_FIELD_PREFIX.length + 1);
      const newViewId = old2NewViewIdMap[oldViewId];
      if (newViewId) {
        const query = this.dbProvider.renameColumn(
          dbTableName,
          name,
          `${ROW_ORDER_FIELD_PREFIX}_${newViewId}`
        );
        for (const sql of query) {
          await this.prismaService.txClient().$executeRawUnsafe(sql);
        }
      }
    }
  }

  private async duplicateJunctionTable(
    fromBaseId: string,
    toBaseId: string,
    tableRaws: { id: string; dbTableName: string }[],
    withRecords?: boolean
  ) {
    const tableIds = tableRaws.map((tableRaw) => tableRaw.id);
    const dbTableNameSet = new Set(tableRaws.map((tableRaw) => tableRaw.dbTableName));

    const linkFieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId: { in: tableIds }, type: FieldType.Link, deletedTime: null },
      select: { id: true, options: true },
    });

    const junctionTables = uniq(
      linkFieldRaws
        .map((linkFieldRaw) => {
          const options = JSON.parse(linkFieldRaw.options as string) as ILinkFieldOptions;
          return options.fkHostTableName;
        })
        .filter((tableName) => !dbTableNameSet.has(tableName))
    );

    for (const dbTableName of junctionTables) {
      const sql = this.dbProvider.duplicateTable(fromBaseId, toBaseId, dbTableName, withRecords);
      await this.prismaService.txClient().$executeRawUnsafe(sql);
    }
  }

  private async duplicateDataTable(
    fromBaseId: string,
    toBaseId: string,
    tableRaws: { id: string; dbTableName: string }[],
    withRecords?: boolean
  ) {
    const userId = this.cls.get('user.id');
    const toDuplicate = tableRaws.map((tableRaw) => tableRaw.dbTableName);

    for (const dbTableName of toDuplicate) {
      const sql = this.dbProvider.duplicateTable(fromBaseId, toBaseId, dbTableName, withRecords);
      const newDbTableName = this.replaceDbTableName(dbTableName, toBaseId);
      await this.prismaService.txClient().$executeRawUnsafe(sql);
      const updateSql = this.knex(newDbTableName)
        .update({
          __created_time: new Date(),
          __last_modified_time: null,
          __created_by: userId,
          __last_modified_by: null,
          __version: 1,
        })
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(updateSql);

      const alterAutoNumber = this.dbProvider.alterAutoNumber(newDbTableName);
      for (const sql of alterAutoNumber) {
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }

      const alterTableSchemaSql = this.knex.schema
        .alterTable(newDbTableName, (table) => {
          table.dropNullable('__id');
          table.unique('__id');
          table.unique('__auto_number');
          table.dateTime('__created_time').defaultTo(this.knex.fn.now()).notNullable().alter();
          table.dropNullable('__created_by');
          table.dropNullable('__version');
        })
        .toSQL()
        .map((item) => item.sql);

      for (const sql of alterTableSchemaSql) {
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }
    }
  }

  private async duplicateDbTable(
    fromBaseId: string,
    toBaseId: string,
    old2NewViewIdMap: Record<string, string>,
    withRecords?: boolean
  ) {
    // create pg schema
    await this.createSchema(toBaseId);

    const tableRaws = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId: fromBaseId, deletedTime: null },
      select: { id: true, dbTableName: true },
    });

    // create visible table
    await this.duplicateDataTable(fromBaseId, toBaseId, tableRaws, withRecords);

    // rename view index fields
    for (const { dbTableName } of tableRaws) {
      await this.renameViewIndexes(
        this.replaceDbTableName(dbTableName, toBaseId),
        old2NewViewIdMap
      );
    }

    // create junction tables for many to many link fields
    await this.duplicateJunctionTable(fromBaseId, toBaseId, tableRaws, withRecords);
  }

  private async duplicateAttachments(
    old2NewTableIdMap: Record<string, string>,
    old2NewFieldIdMap: Record<string, string>
  ) {
    const tableIds = Object.keys(old2NewTableIdMap);
    const attachmentIndexes = await this.prismaService.txClient().attachmentsTable.findMany({
      where: { tableId: { in: tableIds } },
    });

    const userId = this.cls.get('user.id');
    for (const attachmentIndex of attachmentIndexes) {
      const newTableId = old2NewTableIdMap[attachmentIndex.tableId];
      const newFieldId = old2NewFieldIdMap[attachmentIndex.fieldId];
      await this.prismaService.txClient().attachmentsTable.create({
        data: {
          ...attachmentIndex,
          id: undefined,
          tableId: newTableId,
          fieldId: newFieldId,
          createdBy: userId,
          createdTime: new Date(),
        },
      });
    }
  }

  async duplicate(duplicateBaseRo: IDuplicateBaseRo): Promise<ICreateBaseVo> {
    const { fromBaseId, withRecords } = duplicateBaseRo;
    const newBase = await this.duplicateBaseMeta(duplicateBaseRo);
    const toBaseId = newBase.id;
    const old2NewTableIdMap = await this.duplicateTableMeta(fromBaseId, toBaseId);
    this.logger.log(old2NewTableIdMap, 'old2NewTableIdMap');
    const old2NewFieldIdMap = await this.duplicateFields(toBaseId, old2NewTableIdMap);
    this.logger.log(old2NewFieldIdMap, 'old2NewFieldIdMap');
    const old2NewViewIdMap = await this.duplicateViews(old2NewTableIdMap, old2NewFieldIdMap);
    this.logger.log(old2NewViewIdMap, 'old2NewViewIdMap');
    await this.duplicateReferences(old2NewFieldIdMap);
    await this.duplicateDbTable(fromBaseId, toBaseId, old2NewViewIdMap, withRecords);
    if (withRecords) {
      await this.duplicateAttachments(old2NewTableIdMap, old2NewFieldIdMap);
    }
    return newBase;
  }
}
