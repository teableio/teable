import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type { IFormulaFieldOptions, ILinkFieldOptions, ILookupOptionsRo } from '@teable/core';
import {
  FieldType,
  generateBaseId,
  generateDashboardId,
  generatePluginInstallId,
  generatePluginPanelId,
  Role,
} from '@teable/core';
import type { TableMeta } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition, PrincipalType, ResourceType } from '@teable/openapi';
import type { IBaseJson, ICreateBaseVo, IDuplicateBaseRo } from '@teable/openapi';
import { Knex } from 'knex';
import { get, pick } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { TableService } from '../table/table.service';
import { createViewVoByRaw } from '../view/model/factory';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { BaseExportService } from './base-export.service';
import { replaceStringByMap } from './utils';

type IFieldInstanceWithTableId = IFieldInstance & { targetTableId: string; sourceTableId: string };

@Injectable()
export class BaseDuplicateService {
  private logger = new Logger(BaseDuplicateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly tableService: TableService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly exportService: BaseExportService,
    private readonly tableDuplicateService: TableDuplicateService,
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

  private async createBase(spaceId: string, name: string, icon?: string) {
    const userId = this.cls.get('user.id');

    return this.prismaService.$transaction(async (prisma) => {
      const order = (await this.getMaxOrder(spaceId)) + 1;

      const base = await prisma.base.create({
        data: {
          id: generateBaseId(),
          name: name || 'Untitled Base',
          spaceId,
          order,
          icon,
          createdBy: userId,
        },
        select: {
          id: true,
          name: true,
          icon: true,
          spaceId: true,
        },
      });

      const sqlList = this.dbProvider.createSchema(base.id);
      if (sqlList) {
        for (const sql of sqlList) {
          await prisma.$executeRawUnsafe(sql);
        }
      }

      return base;
    });
  }

  async duplicateBase(duplicateBaseRo: IDuplicateBaseRo) {
    const { fromBaseId, spaceId, withRecords, name } = duplicateBaseRo;

    const { base, tableIdMap, fieldIdMap, viewIdMap } = await this.duplicateStructure(
      fromBaseId,
      spaceId,
      name
    );

    if (withRecords) {
      await this.duplicateTableData(tableIdMap, fieldIdMap, viewIdMap);
      await this.duplicateAttachments(tableIdMap, fieldIdMap);
      await this.duplicateLinkJunction(tableIdMap, fieldIdMap);
    }

    return base as ICreateBaseVo;
  }

  protected async duplicateStructure(fromBaseId: string, spaceId: string, baseName?: string) {
    const prisma = this.prismaService.txClient();
    const oldBaseRaw = await prisma.base.findUniqueOrThrow({
      where: { id: fromBaseId, deletedTime: null },
    });

    // create base
    const newBase = await this.createBase(
      spaceId,
      baseName || `${oldBaseRaw.name} (Copy)`,
      oldBaseRaw.icon || undefined
    );

    const { tableIdMap, fieldIdMap, viewIdMap } = await this.duplicateTables(
      fromBaseId,
      newBase.id
    );
    await this.duplicatePlugins(fromBaseId, newBase.id, tableIdMap, fieldIdMap, viewIdMap);

    return { base: newBase, tableIdMap, fieldIdMap, viewIdMap };
  }

  private async duplicateTables(fromBaseId: string, targetBaseId: string) {
    const prisma = this.prismaService.txClient();

    const tableRaws = await prisma.tableMeta.findMany({
      where: { baseId: fromBaseId, deletedTime: null },
    });

    const tableIdMap: Record<string, string> = {};

    for (const table of tableRaws) {
      const { name, icon, description, id: tableId } = table;
      const newTableVo = await this.tableService.createTable(targetBaseId, {
        name,
        icon,
        description,
      });
      tableIdMap[tableId] = newTableVo.id;
    }

    const fieldIdMap = await this.duplicateFields(tableRaws, tableIdMap);

    const viewIdMap = await this.duplicateViews(tableRaws, tableIdMap, fieldIdMap);

    await this.repairFieldOptions(tableIdMap, fieldIdMap, viewIdMap);

    return { tableIdMap, fieldIdMap, viewIdMap };
  }

  private async duplicateFields(tableRaws: TableMeta[], tableIdMap: Record<string, string>) {
    const prisma = this.prismaService.txClient();

    const fieldMap: Record<string, string> = {};

    const allFieldsRaws = await prisma.field.findMany({
      where: { tableId: { in: tableRaws.map((table) => table.id) }, deletedTime: null },
    });

    const allFields = allFieldsRaws.map((field) => ({
      ...createFieldInstanceByRaw(field),
      sourceTableId: field.tableId,
      targetTableId: tableIdMap[field.tableId],
    })) as IFieldInstanceWithTableId[];

    const nonCommonFieldTypes = [FieldType.Link, FieldType.Rollup, FieldType.Formula];

    const commonFields = allFields.filter(
      ({ type, isLookup }) => !nonCommonFieldTypes.includes(type as FieldType) && !isLookup
    );

    const linkFields = allFields.filter(
      ({ type, isLookup }) => type === FieldType.Link && !isLookup
    );

    // formula, rollup, lookup fields
    const dependencyFields = allFields.filter(
      ({ type, isLookup }) =>
        [FieldType.Formula, FieldType.Rollup].includes(type as FieldType) || isLookup
    );

    await this.createCommonFields(commonFields, fieldMap);

    await this.createLinkFields(linkFields, tableIdMap, fieldMap);

    await this.duplicateDependencyFields(dependencyFields, fieldMap);

    return fieldMap;
  }

  private async createCommonFields(
    fields: IFieldInstanceWithTableId[],
    fieldMap: Record<string, string>
  ) {
    for (const field of fields) {
      const {
        name,
        type,
        options,
        targetTableId,
        isPrimary,
        notNull,
        dbFieldName,
        description,
        unique,
      } = field;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        options,
        dbFieldName,
        description,
      });
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      fieldMap[field.id] = newFieldVo.id;
    }
  }

  private async createLinkFields(
    // filter lookup fields
    linkFields: IFieldInstanceWithTableId[],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const selfLinkFields = linkFields.filter(
      ({ options, sourceTableId }) =>
        (options as ILinkFieldOptions).foreignTableId === sourceTableId
    );

    // cross base link fields should convert to one-way link field
    const crossBaseLinkFields = linkFields
      .filter(({ options }) => Boolean((options as ILinkFieldOptions)?.baseId))
      .map((f) => ({
        ...f,
        options: {
          ...f.options,
          isOneWay: true,
        },
      })) as IFieldInstanceWithTableId[];

    // common cross table link fields
    const commonLinkFields = linkFields.filter(
      ({ id }) => ![...selfLinkFields, ...crossBaseLinkFields].map(({ id }) => id).includes(id)
    );

    await this.createSelfLinkFields(selfLinkFields, fieldMap);

    // create cross base link fields
    await this.createCommonLinkFields(crossBaseLinkFields, fieldMap, fieldMap, true);

    await this.createCommonLinkFields(commonLinkFields, tableIdMap, fieldMap);
  }

  private async createSelfLinkFields(
    fields: IFieldInstanceWithTableId[],
    fieldMap: Record<string, string>
  ) {
    const twoWaySelfLinkFields = fields.filter(
      ({ options }) => !(options as ILinkFieldOptions).isOneWay
    );

    const mergedTwoWaySelfLinkFields = [] as [
      IFieldInstanceWithTableId,
      IFieldInstanceWithTableId,
    ][];

    twoWaySelfLinkFields.forEach((f) => {
      // two-way self link field should only create one of it
      if (!mergedTwoWaySelfLinkFields.some((group) => group.some(({ id: fId }) => fId === f.id))) {
        const groupField = twoWaySelfLinkFields.find(
          ({ options }) => get(options, 'symmetricFieldId') === f.id
        );
        groupField && mergedTwoWaySelfLinkFields.push([f, groupField]);
      }
    });

    const oneWaySelfLinkFields = fields.filter(
      ({ options }) => (options as ILinkFieldOptions).isOneWay
    );

    for (const field of oneWaySelfLinkFields) {
      const {
        name,
        targetTableId,
        type,
        options,
        description,
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      } = field;
      const { relationship } = options as ILinkFieldOptions;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        description,
        options: {
          foreignTableId: targetTableId,
          relationship,
        },
      });
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      fieldMap[field.id] = newFieldVo.id;
    }

    for (const field of mergedTwoWaySelfLinkFields) {
      const f = field[0];
      const groupField = field[1];
      const {
        name,
        type,
        id,
        description,
        targetTableId,
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      } = f;
      const options = f.options as ILinkFieldOptions;
      const newField = await this.fieldOpenApiService.createField(targetTableId, {
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
        isPrimary,
      });
      fieldMap[id] = newField.id;
      fieldMap[groupField.id] = (newField.options as ILinkFieldOptions).symmetricFieldId!;

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
            id: fieldMap[groupField.id],
          },
          select: {
            dbFieldName: true,
          },
        });

      await this.prismaService.txClient().field.update({
        where: {
          id: fieldMap[groupField.id],
        },
        data: {
          dbFieldName: groupField.dbFieldName,
          name: groupField.name,
          description: groupField.description,
        },
      });

      if (genDbFieldName !== groupField.dbFieldName) {
        const alterTableSql = this.dbProvider.renameColumn(
          targetDbTableName,
          genDbFieldName,
          groupField.dbFieldName
        );

        for (const sql of alterTableSql) {
          await this.prismaService.txClient().$executeRawUnsafe(sql);
        }
      }
    }
  }

  private async createCommonLinkFields(
    fields: IFieldInstanceWithTableId[],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    crossBase: boolean = false
  ) {
    const oneWayFields = fields.filter(({ options }) => (options as ILinkFieldOptions).isOneWay);
    const twoWayFields = fields.filter(({ options }) => !(options as ILinkFieldOptions).isOneWay);

    for (const field of oneWayFields) {
      const {
        name,
        type,
        options,
        targetTableId,
        description,
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      } = field;
      const { foreignTableId, relationship } = options as ILinkFieldOptions;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        description,
        options: {
          foreignTableId: crossBase ? foreignTableId : tableIdMap[foreignTableId],
          relationship,
          isOneWay: true,
        },
      });
      fieldMap[field.id] = newFieldVo.id;
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
    }

    const groupedTwoWayFields = [] as [IFieldInstanceWithTableId, IFieldInstanceWithTableId][];

    twoWayFields.forEach((f) => {
      // two-way link field should only create one of it
      if (!groupedTwoWayFields.some((group) => group.some(({ id: fId }) => fId === f.id))) {
        const symmetricField = twoWayFields.find(
          ({ options }) => get(options, 'symmetricFieldId') === f.id
        );
        symmetricField && groupedTwoWayFields.push([f, symmetricField]);
      }
    });

    for (const field of groupedTwoWayFields) {
      const {
        name,
        type,
        options,
        targetTableId,
        description,
        id: fieldId,
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      } = field[0];
      const symmetricField = field[1];
      const { foreignTableId, relationship } = options as ILinkFieldOptions;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        description,
        options: {
          foreignTableId: tableIdMap[foreignTableId],
          relationship,
          isOneWay: false,
        },
      });
      fieldMap[fieldId] = newFieldVo.id;
      fieldMap[symmetricField.id] = (newFieldVo.options as ILinkFieldOptions).symmetricFieldId!;
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      await this.repairSymmetricField(
        symmetricField,
        (newFieldVo.options as ILinkFieldOptions).foreignTableId,
        (newFieldVo.options as ILinkFieldOptions).symmetricFieldId!
      );
    }
  }

  private async repairSymmetricField(
    symmetricField: IFieldInstanceWithTableId,
    targetTableId: string,
    newFieldId: string
  ) {
    const { notNull, unique, dbFieldName, isPrimary, description, name } = symmetricField;
    await this.replenishmentConstraint(newFieldId, targetTableId, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    });
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
          id: newFieldId,
        },
        select: {
          dbFieldName: true,
        },
      });

    await this.prismaService.txClient().field.update({
      where: {
        id: newFieldId,
      },
      data: {
        dbFieldName,
        name,
        description,
      },
    });

    if (genDbFieldName !== dbFieldName) {
      const alterTableSql = this.dbProvider.renameColumn(
        targetDbTableName,
        genDbFieldName,
        dbFieldName
      );

      for (const sql of alterTableSql) {
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }
    }
  }

  private async replenishmentConstraint(
    fId: string,
    targetTableId: string,
    {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    }: { notNull?: boolean; unique?: boolean; dbFieldName: string; isPrimary?: boolean }
  ) {
    if (!notNull && !unique && !isPrimary) {
      return;
    }

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
        notNull: notNull ?? null,
        unique: unique ?? null,
        isPrimary: isPrimary ?? null,
      },
    });

    if (notNull || unique) {
      const fieldValidationQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          if (unique) table.dropUnique([dbFieldName]);
          if (notNull) table.setNullable(dbFieldName);
        })
        .toQuery();

      await this.prismaService.txClient().$executeRawUnsafe(fieldValidationQuery);
    }
  }

  // repair link、lookup、rollup field options
  private async repairFieldOptions(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();
    const sourceFieldRaws = await prisma.field.findMany({
      where: {
        id: { in: Object.keys(fieldIdMap) },
      },
    });

    const targetFieldRaws = await prisma.field.findMany({
      where: {
        id: { in: Object.values(fieldIdMap) },
      },
    });

    const sourceFields = sourceFieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const targetFields = targetFieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));

    const linkFields = targetFields.filter(
      (field) => field.type === FieldType.Link && !field.isLookup
    );
    const lookupFields = targetFields.filter((field) => field.isLookup);
    const rollupFields = targetFields.filter((field) => field.type === FieldType.Rollup);

    for (const field of linkFields) {
      const { options, id } = field;
      const sourceField = sourceFields.find((f) => fieldIdMap[f.id] === id);
      const { filter, filterByViewId, visibleFieldIds } = sourceField?.options as ILinkFieldOptions;
      const moreConfigStr = {
        filter,
        filterByViewId,
        visibleFieldIds,
      };

      const newMoreConfigStr = replaceStringByMap(moreConfigStr, {
        tableIdMap,
        fieldIdMap,
        viewIdMap,
      });

      const newOptions = {
        ...options,
        ...JSON.parse(newMoreConfigStr || '{}'),
      };

      await prisma.field.update({
        where: {
          id,
        },
        data: {
          options: JSON.stringify(newOptions),
        },
      });
    }
    for (const field of [...lookupFields, ...rollupFields]) {
      const { lookupOptions, id } = field;
      const sourceField = sourceFields.find((f) => fieldIdMap[f.id] === id);
      const { filter } = sourceField?.lookupOptions as ILookupOptionsRo;
      const moreConfigStr = {
        filter,
      };

      const newMoreConfigStr = replaceStringByMap(moreConfigStr, {
        tableIdMap,
        fieldIdMap,
        viewIdMap,
      });

      const newLookupOptions = {
        ...lookupOptions,
        ...JSON.parse(newMoreConfigStr || '{}'),
      };

      await prisma.field.update({
        where: {
          id,
        },
        data: {
          lookupOptions: JSON.stringify(newLookupOptions),
        },
      });
    }
  }

  private async duplicateDependencyFields(
    dependFields: IFieldInstanceWithTableId[],
    fieldMap: Record<string, string>
  ) {
    if (!dependFields.length) return;

    const checkedField = [] as IFieldInstanceWithTableId[];

    while (dependFields.length) {
      const curField = dependFields.shift();
      if (!curField) continue;

      const { sourceTableId, targetTableId } = curField;

      const isChecked = checkedField.some((f) => f.id === curField.id);
      // InDegree all ready
      const isInDegreeReady = this.isInDegreeReady(curField, fieldMap);

      if (isInDegreeReady) {
        await this.duplicateSingleDependField(sourceTableId, targetTableId, curField, fieldMap);
        continue;
      }

      if (isChecked) {
        if (curField.hasError) {
          await this.duplicateSingleDependField(
            sourceTableId,
            targetTableId,
            curField,
            fieldMap,
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

  private async duplicateSingleDependField(
    sourceTableId: string,
    targetTableId: string,
    field: IFieldInstanceWithTableId,
    sourceToTargetFieldMap: Record<string, string>,
    hasError = false
  ) {
    if (field.type === FieldType.Formula) {
      await this.duplicateFormulaField(targetTableId, field, sourceToTargetFieldMap, hasError);
    } else if (field.isLookup) {
      await this.duplicateLookupField(sourceTableId, targetTableId, field, sourceToTargetFieldMap);
    } else if (field.type === FieldType.Rollup) {
      await this.duplicateRollupField(sourceTableId, targetTableId, field, sourceToTargetFieldMap);
    }
  }

  private async duplicateLookupField(
    sourceTableId: string,
    targetTableId: string,
    field: IFieldInstanceWithTableId,
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
      isPrimary,
    } = field;
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
    const newField = await this.fieldOpenApiService.createField(targetTableId, {
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
      isPrimary,
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

  private async duplicateRollupField(
    sourceTableId: string,
    targetTableId: string,
    fieldInstance: IFieldInstanceWithTableId,
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
      isPrimary,
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
    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type: FieldType.Rollup,
      dbFieldName,
      description,
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
      options,
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
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
    fieldInstance: IFieldInstanceWithTableId,
    sourceToTargetFieldMap: Record<string, string>,
    hasError: boolean = false
  ) {
    const { type, dbFieldName, name, options, id, notNull, unique, description, isPrimary } =
      fieldInstance;
    const { expression } = options as IFormulaFieldOptions;
    const newExpression = replaceStringByMap(expression, { sourceToTargetFieldMap });
    const mockFieldId = Object.values(sourceToTargetFieldMap)[0];
    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type,
      dbFieldName: dbFieldName,
      description,
      options: {
        ...options,
        expression: hasError
          ? `{${mockFieldId}}`
          : newExpression
            ? JSON.parse(newExpression)
            : undefined,
      },
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
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
            expression: newExpression ? JSON.parse(newExpression) : undefined,
          }),
        },
      });
    }
  }

  private isInDegreeReady(field: IFieldInstanceWithTableId, fieldMap: Record<string, string>) {
    if (field.type === FieldType.Formula) {
      const formulaOptions = field.options as IFormulaFieldOptions;
      const referencedFields = this.extractFieldIds(formulaOptions.expression);
      const keys = Object.keys(fieldMap);
      return referencedFields.every((field) => keys.includes(field));
    }

    if (field.isLookup || field.type === FieldType.Rollup) {
      const { lookupOptions, sourceTableId } = field;
      const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptions as ILookupOptionsRo;
      const isSelfLink = foreignTableId === sourceTableId;
      return isSelfLink ? Boolean(fieldMap[lookupFieldId] && fieldMap[linkFieldId]) : true;
    }

    return false;
  }

  private extractFieldIds(expression: string): string[] {
    const matches = expression.match(/\{fld[a-zA-Z0-9]+\}/g);

    if (!matches) {
      return [];
    }
    return matches.map((match) => match.slice(1, -1));
  }

  private async duplicateViews(
    tableRaws: TableMeta[],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();
    const viewMap: Record<string, string> = {};
    const viewRaws = await prisma.view.findMany({
      where: {
        tableId: {
          in: tableRaws.map((table) => table.id),
        },
        deletedTime: null,
      },
    });
    const views = viewRaws.map((viewRaw) => ({
      ...createViewVoByRaw(viewRaw),
      tableId: viewRaw.tableId,
    }));

    for (const view of views) {
      const {
        name,
        type,
        options,
        columnMeta,
        id: viewId,
        description,
        enableShare,
        tableId,
      } = view;
      const newColumnMetaString = replaceStringByMap(columnMeta, { fieldIdMap });
      const newColumnMeta = newColumnMetaString ? JSON.parse(newColumnMetaString) : null;
      const newViewVo = await this.viewOpenApiService.createView(tableIdMap[tableId], {
        name,
        type,
        description,
        enableShare,
        options,
        columnMeta: newColumnMeta,
      });
      viewMap[viewId] = newViewVo.id;
    }

    return viewMap;
  }

  private async duplicatePlugins(
    sourceBaseId: string,
    targetBaseId: string,
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const plugins = await this.exportService.generatePluginJson(sourceBaseId);
    await this.duplicateDashboard(
      targetBaseId,
      plugins[PluginPosition.Dashboard],
      tableIdMap,
      fieldMap
    );
    await this.duplicatePanel(targetBaseId, plugins[PluginPosition.Panel], tableIdMap, fieldMap);
    await this.duplicatePluginViews(
      targetBaseId,
      plugins[PluginPosition.View],
      tableIdMap,
      fieldMap,
      viewIdMap
    );
  }

  private async duplicateDashboard(
    baseId: string,
    plugins: IBaseJson['plugins'][PluginPosition.Dashboard],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const dashboardMap: Record<string, string> = {};
    const pluginInstallMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    const pluginInstalls = plugins.map(({ pluginInstall }) => pluginInstall).flat();

    for (const plugin of plugins) {
      const { id, name } = plugin;
      const newDashBoardId = generateDashboardId();
      await prisma.dashboard.create({
        data: {
          id: newDashBoardId,
          baseId,
          name,
          createdBy: userId,
        },
      });
      dashboardMap[id] = newDashBoardId;
    }

    for (const pluginInstall of pluginInstalls) {
      const { id, pluginId, positionId, position, name, storage } = pluginInstall;
      const newPluginInstallId = generatePluginInstallId();
      const newStorage = replaceStringByMap(storage, { tableMap, fieldMap });
      await prisma.pluginInstall.create({
        data: {
          id: newPluginInstallId,
          createdBy: userId,
          baseId,
          pluginId,
          name,
          positionId: dashboardMap[positionId],
          position,
          storage: newStorage,
        },
      });
      pluginInstallMap[id] = newPluginInstallId;
    }

    // replace pluginId in layout with new pluginInstallId
    for (const plugin of plugins) {
      const { id, layout } = plugin;
      const newLayout = replaceStringByMap(layout, { pluginInstallMap });
      await prisma.dashboard.update({
        where: { id: dashboardMap[id] },
        data: {
          layout: newLayout,
        },
      });
    }

    // create char user to collaborator
    await prisma.collaborator.create({
      data: {
        roleName: Role.Owner,
        createdBy: userId,
        resourceId: baseId,
        resourceType: ResourceType.Base,
        principalType: PrincipalType.User,
        principalId: 'pluchartuser',
      },
    });
  }

  private async duplicatePanel(
    baseId: string,
    plugins: IBaseJson['plugins'][PluginPosition.Panel],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const panelMap: Record<string, string> = {};
    const pluginInstallMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    const pluginInstalls = plugins.map(({ pluginInstall }) => pluginInstall).flat();

    for (const plugin of plugins) {
      const { id, name, tableId } = plugin;
      const newPluginPanelId = generatePluginPanelId();
      await prisma.pluginPanel.create({
        data: {
          id: newPluginPanelId,
          tableId: tableMap[tableId],
          name,
          createdBy: userId,
        },
      });
      panelMap[id] = newPluginPanelId;
    }

    for (const pluginInstall of pluginInstalls) {
      const { id, pluginId, positionId, position, name, storage } = pluginInstall;
      const newPluginInstallId = generatePluginInstallId();
      const newStorage = replaceStringByMap(storage, { tableMap, fieldMap });
      await prisma.pluginInstall.create({
        data: {
          id: newPluginInstallId,
          createdBy: userId,
          baseId,
          pluginId,
          name,
          positionId: panelMap[positionId],
          position,
          storage: newStorage,
        },
      });
      pluginInstallMap[id] = newPluginInstallId;
    }

    // replace pluginId in layout with new pluginInstallId
    for (const plugin of plugins) {
      const { id, layout } = plugin;
      const newLayout = replaceStringByMap(layout, { pluginInstallMap });
      await prisma.pluginPanel.update({
        where: { id: panelMap[id] },
        data: {
          layout: newLayout,
        },
      });
    }
  }

  private async duplicatePluginViews(
    baseId: string,
    pluginViews: IBaseJson['plugins'][PluginPosition.View],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();

    for (const pluginView of pluginViews) {
      const { id, name, description, enableShare, shareMeta, isLocked, tableId, pluginInstall } =
        pluginView;
      const { pluginId } = pluginInstall;
      const { viewId: newViewId, pluginInstallId } = await this.viewOpenApiService.pluginInstall(
        tableIdMap[tableId],
        {
          name,
          pluginId,
        }
      );
      viewIdMap[id] = newViewId;

      // 1. update view options
      const configProperties = ['columnMeta', 'options', 'sort', 'group', 'filter'] as const;
      const updateConfig = {} as Record<(typeof configProperties)[number], string>;
      for (const property of configProperties) {
        const result = replaceStringByMap(pluginView[property], {
          tableIdMap,
          fieldIdMap,
          viewIdMap,
        });

        if (result) {
          updateConfig[property] = result;
        }
      }
      await prisma.view.update({
        where: { id: newViewId },
        data: {
          description,
          isLocked,
          enableShare,
          shareMeta: shareMeta ? JSON.stringify(shareMeta) : undefined,
          ...updateConfig,
        },
      });

      // 2. update plugin install
      const newStorage = replaceStringByMap(pluginInstall.storage, {
        tableIdMap,
        fieldIdMap,
        viewIdMap,
      });
      await prisma.pluginInstall.update({
        where: { id: pluginInstallId },
        data: {
          storage: newStorage,
        },
      });
    }
  }

  private async duplicateTableData(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const tableId2DbTableNameMap: Record<string, string> = {};
    const allTableId = Object.keys(tableIdMap).concat(Object.values(tableIdMap));
    const tableRaws = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: allTableId }, deletedTime: null },
      select: {
        id: true,
        dbTableName: true,
      },
    });
    tableRaws.forEach((tableRaw) => {
      tableId2DbTableNameMap[tableRaw.id] = tableRaw.dbTableName;
    });

    const oldTableId = Object.keys(tableIdMap);
    for (const tableId of oldTableId) {
      const newTableId = tableIdMap[tableId];
      const oldDbTableName = tableId2DbTableNameMap[tableId];
      const newDbTableName = tableId2DbTableNameMap[newTableId];
      await this.tableDuplicateService.duplicateTableData(
        oldDbTableName,
        newDbTableName,
        viewIdMap,
        fieldIdMap
      );
    }
  }

  private async duplicateAttachments(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>
  ) {
    for (const [sourceTableId, targetTableId] of Object.entries(tableIdMap)) {
      await this.tableDuplicateService.duplicateAttachments(
        sourceTableId,
        targetTableId,
        fieldIdMap
      );
    }
  }

  private async duplicateLinkJunction(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>
  ) {
    await this.tableDuplicateService.duplicateLinkJunction(tableIdMap, fieldIdMap);
  }
}
