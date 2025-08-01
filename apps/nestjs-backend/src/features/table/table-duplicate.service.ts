import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import {
  generateViewId,
  generateShareId,
  FieldType,
  ViewType,
  generatePluginInstallId,
} from '@teable/core';
import type { View } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { IDuplicateTableRo, IDuplicateTableVo, IFieldWithTableIdJson } from '@teable/openapi';
import { Knex } from 'knex';
import { get, pick } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { FieldDuplicateService } from '../field/field-duplicate/field-duplicate.service';
import { createFieldInstanceByRaw, rawField2FieldObj } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import { createViewVoByRaw } from '../view/model/factory';
import { TableService } from './table.service';

@Injectable()
export class TableDuplicateService {
  private logger = new Logger(TableDuplicateService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly tableService: TableService,
    private readonly fieldOpenService: FieldOpenApiService,
    private readonly fieldDuplicateService: FieldDuplicateService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async duplicateTable(baseId: string, tableId: string, duplicateRo: IDuplicateTableRo) {
    const { includeRecords, name } = duplicateRo;
    const {
      id: sourceTableId,
      icon,
      description,
      dbTableName,
    } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
    });
    return await this.prismaService.$tx(
      async () => {
        const newTableVo = await this.tableService.createTable(baseId, {
          name,
          icon,
          description,
        });
        const sourceToTargetFieldMap = await this.duplicateFields(sourceTableId, newTableVo.id);
        const sourceToTargetViewMap = await this.duplicateViews(
          sourceTableId,
          newTableVo.id,
          sourceToTargetFieldMap
        );
        await this.repairDuplicateOmit(
          sourceToTargetFieldMap,
          sourceToTargetViewMap,
          newTableVo.id
        );

        if (includeRecords) {
          await this.duplicateTableData(
            dbTableName,
            newTableVo.dbTableName,
            sourceToTargetViewMap,
            sourceToTargetFieldMap,
            []
          );

          await this.duplicateAttachments(sourceTableId, newTableVo.id, sourceToTargetFieldMap);
          await this.duplicateLinkJunction(
            { [sourceTableId]: newTableVo.id },
            sourceToTargetFieldMap
          );
        }

        const viewPlain = await this.prismaService.txClient().view.findMany({
          where: {
            tableId: newTableVo.id,
            deletedTime: null,
          },
        });

        const fieldPlain = await this.prismaService.txClient().field.findMany({
          where: {
            tableId: newTableVo.id,
            deletedTime: null,
          },
          orderBy: {
            createdTime: 'asc',
          },
        });

        return {
          ...newTableVo,
          views: viewPlain.map((v) => createViewVoByRaw(v)),
          fields: fieldPlain.map((f) => rawField2FieldObj(f)),
          viewMap: sourceToTargetViewMap,
          fieldMap: sourceToTargetFieldMap,
        } as IDuplicateTableVo;
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async duplicateTableData(
    sourceDbTableName: string,
    targetDbTableName: string,
    sourceToTargetViewMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>,
    crossBaseLinkInfo: { dbFieldName: string; selfKeyName: string; isMultipleCellValue: boolean }[]
  ) {
    const prisma = this.prismaService.txClient();
    const qb = this.knex.queryBuilder();

    const columnInfoQuery = this.dbProvider.columnInfo(sourceDbTableName);

    const newColumnsInfoQuery = this.dbProvider.columnInfo(targetDbTableName);

    const oldOriginColumns = (await prisma.$queryRawUnsafe<{ name: string }[]>(columnInfoQuery))
      .map(({ name }) => name)
      .filter((name) =>
        crossBaseLinkInfo
          .map(({ selfKeyName }) => selfKeyName)
          .filter((selfKeyName) => selfKeyName !== '__id' && selfKeyName)
          .includes(name)
      );

    const crossBaseLinkDbFieldNames = crossBaseLinkInfo.map(
      ({ dbFieldName, isMultipleCellValue }) => ({
        dbFieldName,
        isMultipleCellValue,
      })
    );

    const newOriginColumns = (
      await prisma.$queryRawUnsafe<{ name: string }[]>(newColumnsInfoQuery)
    ).map(({ name }) => name);

    const oldRowColumns = oldOriginColumns.filter((name) =>
      name.startsWith(ROW_ORDER_FIELD_PREFIX)
    );

    const newFieldColumns = newOriginColumns.filter(
      (name) => !name.startsWith(ROW_ORDER_FIELD_PREFIX) && !name.startsWith('__fk_fld')
    );

    const oldFkColumns = oldOriginColumns.filter((name) => name.startsWith('__fk_fld'));

    const newRowColumns = oldRowColumns.map((name) =>
      sourceToTargetViewMap[name.slice(6)] ? `__row_${sourceToTargetViewMap[name.slice(6)]}` : name
    );

    const newFkColumns = oldFkColumns.map((name) =>
      sourceToTargetFieldMap[name.slice(5)] ? `__fk_${sourceToTargetFieldMap[name.slice(5)]}` : name
    );

    for (const name of newRowColumns) {
      await this.createRowOrderField(targetDbTableName, name.slice(6));
    }

    for (const name of newFkColumns) {
      await this.createFkField(targetDbTableName, name.slice(5));
    }

    // following field should not be duplicated
    const systemColumns = [
      '__auto_number',
      '__created_time',
      '__last_modified_time',
      '__last_modified_by',
    ];

    const excludeFields = await this.prismaService.txClient().field.findMany({
      where: {
        id: {
          in: Object.keys(sourceToTargetFieldMap),
        },
        type: FieldType.Button,
      },
      select: {
        dbFieldName: true,
      },
    });
    const excludeDbFieldNames = excludeFields.map(({ dbFieldName }) => dbFieldName);
    const excludeColumnsSet = new Set([...systemColumns, ...excludeDbFieldNames]);

    // use new table field columns info
    // old table contains ghost columns or customer columns
    const oldColumns = newFieldColumns
      .concat(oldRowColumns)
      .concat(oldFkColumns)
      .filter((dbFieldName) => !excludeColumnsSet.has(dbFieldName));

    const newColumns = newFieldColumns
      .concat(newRowColumns)
      .concat(newFkColumns)
      .filter((dbFieldName) => !excludeColumnsSet.has(dbFieldName));

    const sql = this.dbProvider
      .duplicateTableQuery(qb)
      .duplicateTableData(
        sourceDbTableName,
        targetDbTableName,
        newColumns,
        oldColumns,
        crossBaseLinkDbFieldNames
      )
      .toQuery();

    await prisma.$executeRawUnsafe(sql);
  }

  private async createRowOrderField(dbTableName: string, viewId: string) {
    const prisma = this.prismaService.txClient();

    const rowIndexFieldName = `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;

    const columnExists = await this.dbProvider.checkColumnExist(
      dbTableName,
      rowIndexFieldName,
      prisma
    );

    if (!columnExists) {
      // add a field for maintain row order number
      const addRowIndexColumnSql = this.knex.schema
        .alterTable(dbTableName, (table) => {
          table.double(rowIndexFieldName);
        })
        .toQuery();
      await prisma.$executeRawUnsafe(addRowIndexColumnSql);
    }

    // create index
    const indexName = `idx_${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
    const createRowIndexSQL = this.knex
      .raw(
        `
  CREATE INDEX IF NOT EXISTS ?? ON ?? (??)
`,
        [indexName, dbTableName, rowIndexFieldName]
      )
      .toQuery();

    await prisma.$executeRawUnsafe(createRowIndexSQL);
  }

  private async createFkField(dbTableName: string, fieldId: string) {
    const prisma = this.prismaService.txClient();

    const fkFieldName = `__fk_${fieldId}`;

    const columnExists = await this.dbProvider.checkColumnExist(dbTableName, fkFieldName, prisma);

    if (!columnExists) {
      const addFkColumnSql = this.knex.schema
        .alterTable(dbTableName, (table) => {
          table.string(fkFieldName);
        })
        .toQuery();
      await prisma.$executeRawUnsafe(addFkColumnSql);
    }
  }

  private async duplicateFields(sourceTableId: string, targetTableId: string) {
    const fieldsRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId: sourceTableId, deletedTime: null },
      // for promise the link group create order
      orderBy: {
        createdTime: 'asc',
      },
    });
    const fieldsInstances = fieldsRaw
      .map((f) => ({
        ...createFieldInstanceByRaw(f),
        order: f.order,
        createdTime: f.createdTime.toISOString(),
      }))
      .map((f) => {
        return {
          ...f,
          sourceTableId,
          targetTableId,
        } as IFieldWithTableIdJson;
      });
    const sourceToTargetFieldMap: Record<string, string> = {};
    const tableIdMap: Record<string, string> = {
      [sourceTableId]: targetTableId,
    };

    const nonCommonFieldTypes = [
      FieldType.Link,
      FieldType.Rollup,
      FieldType.Formula,
      FieldType.Button,
    ];

    const commonFields = fieldsInstances.filter(
      ({ type, isLookup, aiConfig }) =>
        !nonCommonFieldTypes.includes(type) && !isLookup && !aiConfig
    );

    // the primary formula which rely on other fields
    const primaryFormulaFields = fieldsInstances.filter(
      ({ type, isLookup }) => type === FieldType.Formula && !isLookup
    );

    // these field require other field, we need to merge them and ensure a specific order
    const linkFields = fieldsInstances.filter(
      ({ type, isLookup }) => type === FieldType.Link && !isLookup
    );

    const buttonFields = fieldsInstances.filter(
      ({ type, isLookup }) => type === FieldType.Button && !isLookup
    );

    // rest fields, like formula, rollup, lookup fields
    const dependencyFields = fieldsInstances.filter(
      ({ id }) =>
        ![...primaryFormulaFields, ...linkFields, ...buttonFields, ...commonFields]
          .map(({ id }) => id)
          .includes(id)
    );

    await this.fieldDuplicateService.createCommonFields(commonFields, sourceToTargetFieldMap);

    await this.fieldDuplicateService.createButtonFields(buttonFields, sourceToTargetFieldMap);

    await this.fieldDuplicateService.createTmpPrimaryFormulaFields(
      primaryFormulaFields,
      sourceToTargetFieldMap
    );

    // main fix formula dbField type
    await this.fieldDuplicateService.repairPrimaryFormulaFields(
      primaryFormulaFields,
      sourceToTargetFieldMap
    );

    // duplicate link fields different from duplicate base link field
    await this.duplicateLinkFields(
      sourceTableId,
      targetTableId,
      linkFields,
      sourceToTargetFieldMap
    );

    await this.fieldDuplicateService.createDependencyFields(
      dependencyFields,
      tableIdMap,
      sourceToTargetFieldMap,
      'table'
    );

    // fix formula expression' field map
    await this.fieldDuplicateService.repairPrimaryFormulaFields(
      primaryFormulaFields,
      sourceToTargetFieldMap
    );

    const formulaFields = fieldsInstances.filter(
      ({ type, isLookup }) => type === FieldType.Formula && !isLookup
    );

    // fix formula reference
    await this.fieldDuplicateService.repairFormulaReference(formulaFields, sourceToTargetFieldMap);

    return sourceToTargetFieldMap;
  }

  private async duplicateLinkFields(
    sourceTableId: string,
    targetTableId: string,
    linkFields: IFieldWithTableIdJson[],
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const twoWaySelfLinkFields = linkFields.filter((f) => {
      const options = f.options as ILinkFieldOptions;
      return options.foreignTableId === sourceTableId;
    });

    const mergedTwoWaySelfLinkFields = [] as [IFieldWithTableIdJson, IFieldWithTableIdJson][];

    twoWaySelfLinkFields.forEach((f) => {
      // two-way self link field should only create one of it
      if (!mergedTwoWaySelfLinkFields.some((group) => group.some(({ id: fId }) => fId === f.id))) {
        const groupField = twoWaySelfLinkFields.find(
          ({ options }) => get(options, 'symmetricFieldId') === f.id
        );
        groupField && mergedTwoWaySelfLinkFields.push([f, groupField]);
      }
    });

    const otherLinkFields = linkFields.filter(
      (f) => !twoWaySelfLinkFields.map((f) => f.id).includes(f.id)
    );

    // self link field
    for (let i = 0; i < mergedTwoWaySelfLinkFields.length; i++) {
      const f = mergedTwoWaySelfLinkFields[i][0];
      const { notNull, unique, description } = f;
      const groupField = mergedTwoWaySelfLinkFields[i][1] as unknown as LinkFieldDto;
      const { name, type, dbFieldName, id, order } = f;
      const options = f.options as ILinkFieldOptions;
      const newField = await this.fieldOpenService.createField(targetTableId, {
        type: type as FieldType,
        dbFieldName,
        name,
        description,
        options: {
          ...pick(options, [
            'relationship',
            'isOneWay',
            'filterByViewId',
            'filter',
            'visibleFieldIds',
          ]),
          foreignTableId: targetTableId,
        },
      });
      await this.fieldDuplicateService.replenishmentConstraint(newField.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
      });
      sourceToTargetFieldMap[id] = newField.id;
      sourceToTargetFieldMap[options.symmetricFieldId!] = (
        newField.options as ILinkFieldOptions
      ).symmetricFieldId!;

      // self link should updated the opposite field dbFieldName and name
      const { dbTableName: targetDbTableName } = await this.prismaService
        .txClient()
        .tableMeta.findUniqueOrThrow({
          where: {
            id: targetTableId,
          },
          select: {
            dbTableName: true,
          },
        });

      const { dbFieldName: genDbFieldName } = await this.prismaService
        .txClient()
        .field.findUniqueOrThrow({
          where: {
            id: sourceToTargetFieldMap[groupField.id],
          },
          select: {
            dbFieldName: true,
          },
        });

      await this.prismaService.txClient().field.update({
        where: {
          id: sourceToTargetFieldMap[groupField.id],
        },
        data: {
          dbFieldName: groupField.dbFieldName,
          name: groupField.name,
          options: JSON.stringify({ ...groupField.options, foreignTableId: targetTableId }),
        },
      });

      const alterTableSql = this.dbProvider.renameColumn(
        targetDbTableName,
        genDbFieldName,
        groupField.dbFieldName
      );

      for (const sql of alterTableSql) {
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }
    }

    // other common link field
    for (let i = 0; i < otherLinkFields.length; i++) {
      const f = otherLinkFields[i];
      const { type, description, name, notNull, unique, options, dbFieldName, order } = f;
      const newField = await this.fieldOpenService.createField(targetTableId, {
        type: type as FieldType,
        description,
        dbFieldName,
        name,
        options: {
          ...pick(options, [
            'relationship',
            'foreignTableId',
            'isOneWay',
            'filterByViewId',
            'filter',
            'visibleFieldIds',
          ]),
          // duplicate link field always be one-way, consider that advanced auth control etc.
          isOneWay: true,
        },
      });
      await this.fieldDuplicateService.replenishmentConstraint(newField.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
      });
      sourceToTargetFieldMap[f.id] = newField.id;
    }
  }

  private async duplicateViews(
    sourceTableId: string,
    targetTableId: string,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const views = await this.prismaService.view.findMany({
      where: { tableId: sourceTableId, deletedTime: null },
    });
    const viewsWithoutPlugin = views.filter((v) => v.type !== ViewType.Plugin);
    const pluginViews = views.filter(({ type }) => type === ViewType.Plugin);
    const sourceToTargetViewMap = {} as Record<string, string>;
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    await prisma.view.createMany({
      data: viewsWithoutPlugin.map((view) => {
        const fieldsToReplace = ['columnMeta', 'options', 'sort', 'group', 'filter'] as const;

        const updatedFields = fieldsToReplace.reduce(
          (acc, field) => {
            if (view[field]) {
              acc[field] = Object.entries(sourceToTargetFieldMap).reduce(
                (result, [key, value]) => result.replaceAll(key, value),
                view[field]!
              );
            }
            return acc;
          },
          {} as Partial<typeof view>
        );

        const newViewId = generateViewId();

        sourceToTargetViewMap[view.id] = newViewId;

        return {
          ...view,
          createdTime: new Date().toISOString(),
          createdBy: userId,
          version: 1,
          tableId: targetTableId,
          id: newViewId,
          shareId: generateShareId(),
          ...updatedFields,
        };
      }),
    });

    // duplicate plugin view
    await this.duplicatePluginViews(
      targetTableId,
      pluginViews,
      sourceToTargetViewMap,
      sourceToTargetFieldMap
    );

    return sourceToTargetViewMap;
  }

  private async duplicatePluginViews(
    targetTableId: string,
    pluginViews: View[],
    sourceToTargetViewMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();

    if (!pluginViews.length) return;

    const pluginData = await prisma.pluginInstall.findMany({
      where: {
        id: {
          in: pluginViews.map((v) => (v.options ? JSON.parse(v.options).pluginInstallId : null)),
        },
      },
    });

    for (const view of pluginViews) {
      const plugin = view.options ? JSON.parse(view.options) : null;
      if (!plugin) {
        throw new BadGatewayException('Duplicate plugin view error: pluginId not found');
      }
      const { pluginInstallId, pluginId } = plugin;

      const newPluginInsId = generatePluginInstallId();
      const newViewId = generateViewId();

      sourceToTargetViewMap[view.id] = newViewId;

      const pluginInfo = pluginData.find((p) => p.id === pluginInstallId);

      if (!pluginInfo) continue;

      let curPluginStorage = pluginInfo?.storage;
      let pluginOptions = plugin.options;

      if (curPluginStorage) {
        Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
          curPluginStorage = curPluginStorage?.replaceAll(key, value) || null;
        });
      }

      if (pluginOptions) {
        Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
          pluginOptions = pluginOptions.replaceAll(key, value);
        });
        pluginOptions = pluginOptions.replaceAll(pluginId, newPluginInsId);
      }

      const fieldsToReplace = ['columnMeta', 'options', 'sort', 'group', 'filter'] as const;

      const updatedFields = fieldsToReplace.reduce(
        (acc, field) => {
          if (view[field]) {
            acc[field] = Object.entries(sourceToTargetFieldMap).reduce(
              (result, [key, value]) => result.replaceAll(key, value),
              view[field]!
            );
          }
          return acc;
        },
        {} as Partial<typeof view>
      );

      await prisma.pluginInstall.create({
        data: {
          ...pluginInfo,
          createdBy: this.cls.get('user.id'),
          id: newPluginInsId,
          createdTime: new Date().toISOString(),
          lastModifiedBy: null,
          lastModifiedTime: null,
          storage: curPluginStorage,
          positionId: newViewId,
        },
      });

      await prisma.view.create({
        data: {
          ...view,
          createdTime: new Date().toISOString(),
          createdBy: this.cls.get('user.id'),
          version: 1,
          tableId: targetTableId,
          id: newViewId,
          shareId: generateShareId(),
          options: pluginOptions,
          ...updatedFields,
        },
      });
    }

    return sourceToTargetViewMap;
  }

  private async repairDuplicateOmit(
    sourceToTargetFieldMap: Record<string, string>,
    sourceToTargetViewMap: Record<string, string>,
    targetTableId: string
  ) {
    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: targetTableId,
        deletedTime: null,
      },
      orderBy: {
        createdTime: 'asc',
      },
    });

    const selfLinkFields = fieldRaw.filter(
      ({ type, options }) =>
        type === FieldType.Link &&
        options &&
        (JSON.parse(options) as ILinkFieldOptions)?.foreignTableId === targetTableId
    );

    for (const field of selfLinkFields) {
      const { id: fieldId, options } = field;
      if (!options) continue;

      let newOptions = options;

      Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
        newOptions = newOptions.replaceAll(key, value);
      });

      Object.entries(sourceToTargetViewMap).forEach(([key, value]) => {
        newOptions = newOptions.replaceAll(key, value);
      });

      await this.prismaService.txClient().field.update({
        where: {
          id: fieldId,
        },
        data: {
          options: newOptions,
        },
      });
    }
  }

  private extractFieldIds(expression: string): string[] {
    const matches = expression.match(/\{fld[a-zA-Z0-9]+\}/g);

    if (!matches) {
      return [];
    }
    return matches.map((match) => match.slice(1, -1));
  }

  async duplicateAttachments(
    sourceTableId: string,
    targetTableId: string,
    fieldIdMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();
    const attachmentFieldRaws = await prisma.field.findMany({
      where: {
        tableId: sourceTableId,
        type: FieldType.Attachment,
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });
    const qb = this.knex.queryBuilder();

    const attachmentFieldIds = attachmentFieldRaws.map(({ id }) => id);

    const userId = this.cls.get('user.id');

    for (const attachmentFieldId of attachmentFieldIds) {
      const sql = this.dbProvider
        .duplicateAttachmentTableQuery(qb)
        .duplicateAttachmentTable(
          sourceTableId,
          targetTableId,
          attachmentFieldId,
          fieldIdMap[attachmentFieldId],
          userId
        )
        .toQuery();

      await prisma.$executeRawUnsafe(sql);
    }
  }

  // duplicate link junction table
  async duplicateLinkJunction(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    allowCrossBase: boolean = true
  ) {
    const prisma = this.prismaService.txClient();
    const sourceLinkFieldRaws = await prisma.field.findMany({
      where: {
        tableId: { in: Object.keys(tableIdMap) },
        type: FieldType.Link,
        deletedTime: null,
      },
    });

    const targetLinkFieldRaws = await prisma.field.findMany({
      where: {
        tableId: { in: Object.values(tableIdMap) },
        type: FieldType.Link,
        deletedTime: null,
      },
    });

    const sourceFields = sourceLinkFieldRaws
      .filter(({ isLookup }) => !isLookup)
      .map((f) => createFieldInstanceByRaw(f))
      .filter((field) => {
        if (allowCrossBase) {
          return true;
        }
        // if not allow cross base, filter out it.
        return !(field.options as ILinkFieldOptions).baseId;
      });
    const targetFields = targetLinkFieldRaws.map((f) => createFieldInstanceByRaw(f));

    const junctionDbTableNameMap = {} as Record<
      string,
      {
        sourceSelfKeyName: string;
        sourceForeignKeyName: string;
        targetSelfKeyName: string;
        targetForeignKeyName: string;
        targetFkHostTableName: string;
      }
    >;

    for (const sourceField of sourceFields) {
      const { options: sourceOptions } = sourceField;
      const {
        fkHostTableName: sourceFkHostTableName,
        selfKeyName: sourceSelfKeyName,
        foreignKeyName: sourceForeignKeyName,
      } = sourceOptions as ILinkFieldOptions;
      const targetField = targetFields.find((f) => f.id === fieldIdMap[sourceField.id])!;
      const { options: targetOptions } = targetField;
      const {
        fkHostTableName: targetFkHostTableName,
        selfKeyName: targetSelfKeyName,
        foreignKeyName: targetForeignKeyName,
      } = targetOptions as ILinkFieldOptions;
      if (sourceFkHostTableName.includes('junction_')) {
        junctionDbTableNameMap[sourceFkHostTableName] = {
          sourceSelfKeyName,
          sourceForeignKeyName,
          targetSelfKeyName,
          targetForeignKeyName,
          targetFkHostTableName,
        };
      }
    }
    for (const [sourceJunctionDbTableName, targetJunctionInfo] of Object.entries(
      junctionDbTableNameMap
    )) {
      const {
        sourceSelfKeyName,
        sourceForeignKeyName,
        targetSelfKeyName,
        targetForeignKeyName,
        targetFkHostTableName,
      } = targetJunctionInfo;
      const sql = this.knex
        .raw(
          `INSERT INTO ?? ("${targetSelfKeyName}","${targetForeignKeyName}") SELECT "${sourceSelfKeyName}", "${sourceForeignKeyName}" FROM ??`,
          [targetFkHostTableName, sourceJunctionDbTableName]
        )
        .toQuery();

      await prisma.$executeRawUnsafe(sql);
    }
  }
}
