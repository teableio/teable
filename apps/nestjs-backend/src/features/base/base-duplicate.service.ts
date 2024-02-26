import { Injectable, NotFoundException } from '@nestjs/common';
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
import type { IDuplicateBaseRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { replaceExpressionFieldIds, replaceJsonStringFieldIds } from './utils';

@Injectable()
export class BaseDuplicateService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  private async getMaxOrder(spaceId: string) {
    const spaceAggregate = await this.prismaService.txClient().base.aggregate({
      where: { spaceId, deletedTime: null },
      _max: { order: true },
    });
    return spaceAggregate._max.order || 0;
  }

  private async duplicateBaseMeta(baseId: string, duplicateBaseRo: IDuplicateBaseRo) {
    const { toSpaceId, name } = duplicateBaseRo;
    const base = await this.prismaService.txClient().base.findFirst({
      where: {
        id: baseId,
        deletedTime: null,
      },
    });
    if (!base) {
      throw new NotFoundException('Base not found');
    }
    const userId = this.cls.get('user.id');
    const toBaseId = generateBaseId();
    await this.prismaService.txClient().base.create({
      data: {
        id: toBaseId,
        name: name ? name : base.name,
        icon: base.icon,
        order: (await this.getMaxOrder(toSpaceId)) + 1,
        spaceId: toSpaceId,
        createdBy: userId,
        lastModifiedBy: userId,
      },
    });
    return toBaseId;
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

  private async duplicateFields(old2NewTableIdMap: Record<string, string>) {
    const oldFields: { field: IFieldInstance; fieldRaw: Field }[] = [];
    const old2NewFieldIdMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: { in: Object.keys(old2NewTableIdMap) },
        deletedTime: null,
      },
    });

    fieldRaws.forEach((fieldRaw) => {
      oldFields.push({ field: createFieldInstanceByRaw(fieldRaw), fieldRaw });
      old2NewFieldIdMap[fieldRaw.id] = generateFieldId();
    });

    oldFields.forEach(({ field, fieldRaw }) => {
      const newFieldRaw = {
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
    });

    return old2NewFieldIdMap;
  }

  private convertFieldIdInJSON(old2NewFieldIdMap: Record<string, string>, jsonStr: string) {
    const json = JSON.parse(jsonStr);
    for (const fieldId in old2NewFieldIdMap) {
      if (json[fieldId]) {
        json[old2NewFieldIdMap[fieldId]] = json[fieldId];
        delete json[fieldId];
      }
    }
    return JSON.stringify(json);
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
    for (const viewRaw of viewRaws) {
      const newView = {
        ...viewRaw,
        id: generateViewId(),
        tableId: old2NewTableIdMap[viewRaw.tableId],
        version: 1,
        createdTime: new Date(),
        lastModifiedTime: new Date(),
        createdBy: userId,
        lastModifiedBy: userId,
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
  }

  private async duplicateReferences(old2NewFieldIdMap: Record<string, string>) {
    const allFieldIds = Object.keys(old2NewFieldIdMap);
    const references = await this.prismaService.txClient().reference.findMany({
      where: { fromFieldId: { in: allFieldIds } },
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

  private async duplicateDbTable(fromBaseId: string, toBaseId: string, withRecords?: boolean) {
    await this.createSchema(toBaseId);

    const tableRaws = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId: fromBaseId, deletedTime: null },
      select: { id: true, dbTableName: true },
    });

    const tableIds = tableRaws.map((tableRaw) => tableRaw.id);
    const dbTableNameSet = new Set(tableRaws.map((tableRaw) => tableRaw.dbTableName));

    const linkFieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId: { in: tableIds }, type: FieldType.Link },
      select: { id: true, options: true },
    });

    const junctionTables = linkFieldRaws
      .map((linkFieldRaw) => {
        const options = JSON.parse(linkFieldRaw.options as string) as ILinkFieldOptions;
        return options.fkHostTableName;
      })
      .filter((tableName) => !dbTableNameSet.has(tableName));

    const toDuplicate = tableRaws.map((tableRaw) => tableRaw.dbTableName).concat(junctionTables);

    for (const dbTableName of toDuplicate) {
      const sql = this.dbProvider.duplicateTable(fromBaseId, toBaseId, dbTableName, withRecords);
      await this.prismaService.txClient().$executeRawUnsafe(sql);
    }
  }

  private async reIndexAttachments(
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
          lastModifiedBy: userId,
          createdTime: new Date(),
        },
      });
    }
  }

  async duplicate(baseId: string, duplicateBaseRo: IDuplicateBaseRo): Promise<string> {
    const withRecords = duplicateBaseRo.withRecords;
    const toBaseId = await this.duplicateBaseMeta(baseId, duplicateBaseRo);
    const old2NewTableIdMap = await this.duplicateTableMeta(baseId, toBaseId);
    const old2NewFieldIdMap = await this.duplicateFields(old2NewTableIdMap);
    await this.duplicateViews(old2NewTableIdMap, old2NewFieldIdMap);
    await this.duplicateReferences(old2NewFieldIdMap);
    await this.duplicateDbTable(baseId, toBaseId, withRecords);
    if (withRecords) {
      await this.reIndexAttachments(old2NewTableIdMap, old2NewFieldIdMap);
    }
    return toBaseId;
  }
}
