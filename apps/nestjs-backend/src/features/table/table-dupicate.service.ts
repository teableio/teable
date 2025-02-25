import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type { IFormulaFieldOptions, ILinkFieldOptions, ILookupOptionsRo } from '@teable/core';
import {
  generateViewId,
  generateShareId,
  FieldType,
  ViewType,
  generatePluginInstallId,
} from '@teable/core';
import type { View } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type { IDuplicateTableRo, IDuplicateTableVo } from '@teable/openapi';
import { Knex } from 'knex';
import { get, pick } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw, rawField2FieldObj } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import { createViewVoByRaw } from '../view/model/factory';
import { ViewOpenApiService } from './../view/open-api/view-open-api.service';
import { TableService } from './table.service';

@Injectable()
export class TableDuplicateService {
  private logger = new Logger(TableDuplicateService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly tableService: TableService,
    private readonly fieldOpenService: FieldOpenApiService,
    private readonly viewOpenService: ViewOpenApiService,
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

        includeRecords &&
          (await this.duplicateTableData(
            dbTableName,
            newTableVo.dbTableName,
            sourceToTargetViewMap,
            sourceToTargetFieldMap
          ));

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
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();
    const qb = this.knex.queryBuilder();

    const columnInfoQuery = this.dbProvider.columnInfo(sourceDbTableName);

    const oldOriginColumns = (
      await this.prismaService.txClient().$queryRawUnsafe<{ name: string }[]>(columnInfoQuery)
    ).map(({ name }) => name);

    const oldFieldColumns = oldOriginColumns.filter(
      (name) => !name.startsWith(ROW_ORDER_FIELD_PREFIX) && !name.startsWith('__fk_fld')
    );

    const oldRowColumns = oldOriginColumns.filter((name) =>
      name.startsWith(ROW_ORDER_FIELD_PREFIX)
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

    const oldColumns = oldFieldColumns.concat(oldRowColumns).concat(oldFkColumns);

    const newColumns = oldFieldColumns.concat(newRowColumns).concat(newFkColumns);

    const sql = this.dbProvider
      .duplicateTableQuery(qb)
      .duplicateTableData(sourceDbTableName, targetDbTableName, newColumns, oldColumns)
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
    });
    const fieldsInstances = fieldsRaw.map((f) => createFieldInstanceByRaw(f));
    const sourceToTargetFieldMap: Record<string, string> = {};

    const commonFields = fieldsInstances.filter(
      (f) => !f.isLookup && ![FieldType.Formula, FieldType.Link].includes(f.type as FieldType)
    );

    for (let i = 0; i < commonFields.length; i++) {
      const { type, dbFieldName, name, options, isPrimary, id, unique, notNull, description } =
        commonFields[i];
      const newField = await this.fieldOpenService.createField(targetTableId, {
        type,
        dbFieldName: dbFieldName,
        name,
        options,
        description,
      });
      if (isPrimary || unique || notNull) {
        const updateData: {
          isPrimary?: boolean;
          unique?: boolean;
          notNull?: boolean;
        } = {
          isPrimary,
        };
        if (unique !== undefined) updateData.unique = unique;
        if (notNull !== undefined) updateData.notNull = notNull;

        if (Object.keys(updateData).length > 0) {
          await this.prismaService.txClient().field.update({
            where: {
              id: newField?.id,
            },
            data: updateData,
          });
        }
      }
      sourceToTargetFieldMap[id] = newField.id;
    }

    // these field require other field, we need to merge them and ensure a specific order
    const linkFields = fieldsInstances.filter((f) => f.type === FieldType.Link && !f.isLookup);

    await this.duplicateLinkFields(
      sourceTableId,
      targetTableId,
      linkFields,
      sourceToTargetFieldMap
    );

    await this.duplicateDependFields(
      sourceTableId,
      targetTableId,
      fieldsInstances,
      sourceToTargetFieldMap
    );

    return sourceToTargetFieldMap;
  }

  // field could not set constraint when create
  private async replenishmentConstraint(
    fId: string,
    targetTableId: string,
    { notNull, unique, dbFieldName }: { notNull?: boolean; unique?: boolean; dbFieldName: string }
  ) {
    if (notNull || unique) {
      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
          deletedTime: null,
        },
        select: {
          dbTableName: true,
        },
      });
      await this.prismaService.txClient().field.update({
        where: {
          id: fId,
        },
        data: {
          notNull,
          unique,
        },
      });

      const fieldValidationQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          if (unique) table.dropUnique([dbFieldName]);
          if (notNull) table.setNullable(dbFieldName);
        })
        .toQuery();

      await this.prismaService.txClient().$executeRawUnsafe(fieldValidationQuery);
    }
  }

  private async duplicateLinkFields(
    sourceTableId: string,
    targetTableId: string,
    linkFields: IFieldInstance[],
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const twoWaySelfLinkFields = linkFields.filter((f) => {
      const options = f.options as ILinkFieldOptions;
      return options.foreignTableId === sourceTableId;
    });

    const mergedTwoWaySelfLinkFields = [] as [IFieldInstance, IFieldInstance][];

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
      const groupField = mergedTwoWaySelfLinkFields[i][1] as LinkFieldDto;
      const { name, type, dbFieldName, id } = f;
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
      await this.replenishmentConstraint(newField.id, targetTableId, {
        notNull,
        unique,
        dbFieldName,
      });
      if (notNull || unique) {
        await this.prismaService.txClient().field.update({
          where: {
            id: newField?.id,
          },
          data: {
            unique,
            notNull,
          },
        });
      }
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
      const { type, description, name, notNull, unique, options, dbFieldName } = f;
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
        },
      });
      await this.replenishmentConstraint(newField.id, targetTableId, {
        notNull,
        unique,
        dbFieldName,
      });
      sourceToTargetFieldMap[f.id] = newField.id;
    }
  }

  private async duplicateDependFields(
    sourceTableId: string,
    targetTableId: string,
    fieldsInstances: IFieldInstance[],
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const dependFields = fieldsInstances.filter((f) => f.isLookup || f.type === FieldType.Formula);
    if (!dependFields.length) return;

    const checkedField = [] as IFieldInstance[];

    while (dependFields.length) {
      const curField = dependFields.shift();
      if (!curField) continue;

      const isChecked = checkedField.some((f) => f.id === curField.id);
      // InDegree all ready
      const isInDegreeReady = this.isInDegreeReady(curField, sourceTableId, sourceToTargetFieldMap);

      if (isInDegreeReady) {
        await this.duplicateSingleDependField(
          sourceTableId,
          targetTableId,
          curField,
          sourceToTargetFieldMap
        );
        continue;
      }

      if (isChecked) {
        if (curField.hasError) {
          await this.duplicateSingleDependField(
            sourceTableId,
            targetTableId,
            curField,
            sourceToTargetFieldMap,
            true
          );
        } else {
          throw new BadGatewayException('Create circular field');
        }
      } else {
        dependFields.push(curField);
        checkedField.push(curField);
      }
    }
  }

  private isInDegreeReady(
    field: IFieldInstance,
    sourceTableId: string,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    if (field.type === FieldType.Formula) {
      const formulaOptions = field.options as IFormulaFieldOptions;
      const referencedFields = this.extractFieldIds(formulaOptions.expression);
      const keys = Object.keys(sourceToTargetFieldMap);
      return referencedFields.every((field) => keys.includes(field));
    }

    if (field.isLookup) {
      const { lookupOptions } = field;
      const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptions as ILookupOptionsRo;
      const isSelfLink = foreignTableId === sourceTableId;
      return isSelfLink
        ? Boolean(sourceToTargetFieldMap[lookupFieldId] && sourceToTargetFieldMap[linkFieldId])
        : true;
    }

    return false;
  }

  private async duplicateSingleDependField(
    sourceTableId: string,
    targetTableId: string,
    field: IFieldInstance,
    sourceToTargetFieldMap: Record<string, string>,
    hasError = false
  ) {
    if (field.type === FieldType.Formula) {
      await this.duplicateFormulaField(targetTableId, field, sourceToTargetFieldMap, hasError);
    } else if (field.isLookup) {
      await this.duplicateLookupField(sourceTableId, targetTableId, field, sourceToTargetFieldMap);
    }
  }

  private async duplicateLookupField(
    sourceTableId: string,
    targetTableId: string,
    fieldInstance: IFieldInstance,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const {
      dbFieldName,
      name,
      lookupOptions,
      id,
      hasError,
      options,
      notNull,
      unique,
      description,
    } = fieldInstance;
    const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptions as ILookupOptionsRo;
    const isSelfLink = foreignTableId === sourceTableId;

    const { type: lookupFieldType } = await this.prismaService.txClient().field.findUniqueOrThrow({
      where: {
        id: lookupFieldId,
      },
      select: {
        type: true,
      },
    });
    const mockFieldId = Object.values(sourceToTargetFieldMap)[0];
    const { type: mockType } = await this.prismaService.txClient().field.findUniqueOrThrow({
      where: {
        id: mockFieldId,
        deletedTime: null,
      },
      select: {
        type: true,
      },
    });
    const newField = await this.fieldOpenService.createField(targetTableId, {
      type: (hasError ? mockType : lookupFieldType) as FieldType,
      dbFieldName,
      description,
      isLookup: true,
      lookupOptions: {
        foreignTableId: isSelfLink ? targetTableId : foreignTableId,
        linkFieldId: isSelfLink ? sourceToTargetFieldMap[linkFieldId] : linkFieldId,
        lookupFieldId: isSelfLink
          ? hasError
            ? mockFieldId
            : sourceToTargetFieldMap[lookupFieldId]
          : hasError
            ? mockFieldId
            : lookupFieldId,
      },
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, {
      notNull,
      unique,
      dbFieldName,
    });
    sourceToTargetFieldMap[id] = newField.id;
    if (hasError) {
      await this.prismaService.txClient().field.update({
        where: {
          id: newField.id,
        },
        data: {
          hasError,
          type: lookupFieldType,
          lookupOptions: JSON.stringify({
            ...newField.lookupOptions,
            lookupFieldId: lookupFieldId,
          }),
          options: JSON.stringify(options),
        },
      });
    }
  }

  private async duplicateFormulaField(
    targetTableId: string,
    fieldInstance: IFieldInstance,
    sourceToTargetFieldMap: Record<string, string>,
    hasError: boolean = false
  ) {
    const { type, dbFieldName, name, options, id, notNull, unique, description } = fieldInstance;
    const { expression } = options as IFormulaFieldOptions;
    let newExpression = expression;
    Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
      newExpression = newExpression.replaceAll(key, value);
    });
    const mockFieldId = Object.values(sourceToTargetFieldMap)[0];
    const newField = await this.fieldOpenService.createField(targetTableId, {
      type,
      dbFieldName: dbFieldName,
      description,
      options: {
        ...options,
        expression: hasError ? `{${mockFieldId}}` : newExpression,
      },
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, {
      notNull,
      unique,
      dbFieldName,
    });
    sourceToTargetFieldMap[id] = newField.id;

    if (hasError) {
      await this.prismaService.txClient().field.update({
        where: {
          id: newField.id,
        },
        data: {
          hasError,
          options: JSON.stringify({
            ...options,
            expression: newExpression,
          }),
        },
      });
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
}
