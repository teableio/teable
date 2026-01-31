/* eslint-disable sonarjs/cognitive-complexity */
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type {
  IFieldVo,
  IFormulaFieldOptions,
  ILinkFieldOptions,
  ILookupOptionsRo,
  IConditionalRollupFieldOptions,
  IConditionalLookupOptions,
  IFilter,
  IFieldRo,
} from '@teable/core';
import {
  FieldType,
  HttpErrorCode,
  extractFieldIdsFromFilter,
  isConditionalLookupOptions,
  isLinkLookupOptions,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson, IFieldJson, IFieldWithTableIdJson } from '@teable/openapi';
import { Knex } from 'knex';
import { pick, get } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { CustomHttpException } from '../../../custom.exception';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { extractFieldReferences } from '../../../utils';
import { DEFAULT_EXPRESSION } from '../../base/constant';
import { replaceStringByMap } from '../../base/utils';
import { TableDomainQueryService } from '../../table-domain/table-domain-query.service';
import { LinkFieldQueryService } from '../field-calculate/link-field-query.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByRaw } from '../model/factory';
import { FieldOpenApiService } from '../open-api/field-open-api.service';

@Injectable()
export class FieldDuplicateService {
  private readonly logger = new Logger(FieldDuplicateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly linkFieldQueryService: LinkFieldQueryService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly tableDomainQueryService: TableDomainQueryService
  ) {}

  async createCommonFields(fields: IFieldWithTableIdJson[], fieldMap: Record<string, string>) {
    const byTable = new Map<string, IFieldWithTableIdJson[]>();
    for (const field of fields) {
      const list = byTable.get(field.targetTableId) ?? [];
      list.push(field);
      byTable.set(field.targetTableId, list);
    }

    for (const [targetTableId, tableFields] of byTable.entries()) {
      const fieldRos: IFieldRo[] = tableFields.map(
        ({ name, type, options, dbFieldName, description }) => ({
          name,
          type,
          options,
          dbFieldName,
          description,
        })
      );

      const newFieldVos = await this.fieldOpenApiService.createFieldsByRo(targetTableId, fieldRos);

      for (let index = 0; index < tableFields.length; index++) {
        const original = tableFields[index];
        const newFieldVo = newFieldVos[index];
        await this.replenishmentConstraint(newFieldVo.id, targetTableId, original.order, {
          notNull: original.notNull,
          unique: original.unique,
          dbFieldName: newFieldVo.dbFieldName,
          isPrimary: original.isPrimary,
        });
        fieldMap[original.id] = newFieldVo.id;
      }
    }
  }

  async createButtonFields(fields: IFieldWithTableIdJson[], fieldMap: Record<string, string>) {
    const newFields = fields.map((field) => {
      const { options } = field;
      return {
        ...field,
        options: {
          ...options,
          workflow: undefined,
        },
      };
    }) as IFieldWithTableIdJson[];
    return await this.createCommonFields(newFields, fieldMap);
  }

  async createTmpPrimaryFormulaFields(
    primaryFormulaFields: IFieldWithTableIdJson[],
    fieldMap: Record<string, string>
  ) {
    const byTable = new Map<string, IFieldWithTableIdJson[]>();
    for (const field of primaryFormulaFields) {
      const list = byTable.get(field.targetTableId) ?? [];
      list.push(field);
      byTable.set(field.targetTableId, list);
    }

    for (const [targetTableId, tableFields] of byTable.entries()) {
      const fieldRos: IFieldRo[] = tableFields.map(
        ({ type, dbFieldName, description, options, name }) => ({
          type,
          dbFieldName,
          description,
          options: {
            expression: DEFAULT_EXPRESSION,
            timeZone: (options as IFormulaFieldOptions).timeZone,
          },
          name,
        })
      );

      const newFields = await this.fieldOpenApiService.createFieldsByRo(targetTableId, fieldRos);

      for (let index = 0; index < tableFields.length; index++) {
        const original = tableFields[index];
        const newField = newFields[index];

        // Ensure meta is present for Postgres generated columns
        // In duplication flow, we use a safe default expression that is supported as generated column
        // Explicitly persist meta to satisfy consumers expecting it on error formulas
        if (newField.meta) {
          await this.prismaService.txClient().field.update({
            where: { id: newField.id },
            data: { meta: JSON.stringify(newField.meta) },
          });
        }

        await this.replenishmentConstraint(newField.id, targetTableId, original.order, {
          notNull: original.notNull,
          unique: original.unique,
          dbFieldName: original.dbFieldName,
          isPrimary: original.isPrimary,
        });
        fieldMap[original.id] = newField.id;

        if (original.hasError) {
          await this.prismaService.txClient().field.update({
            where: {
              id: newField.id,
            },
            data: {
              hasError: original.hasError,
              // error formulas should not be persisted as generated columns
              meta: null,
            },
          });
        }
      }
    }
  }

  async repairPrimaryFormulaFields(
    primaryFormulaFields: IFieldWithTableIdJson[],
    fieldMap: Record<string, string>
  ) {
    for (const field of primaryFormulaFields) {
      const { id, options, dbFieldType, targetTableId, cellValueType, isMultipleCellValue } = field;
      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });
      const tableDomain = await this.tableDomainQueryService.getTableDomainById(targetTableId);
      const newOptions = replaceStringByMap(options, { fieldMap });
      const { dbFieldType: currentDbFieldType } = await this.prismaService.txClient().field.update({
        where: {
          id: fieldMap[id],
        },
        data: {
          options: newOptions,
          cellValueType,
        },
      });
      if (currentDbFieldType !== dbFieldType) {
        // Create field instance for the updated field
        const updatedFieldRaw = await this.prismaService.txClient().field.findUniqueOrThrow({
          where: { id: fieldMap[id] },
        });
        const fieldInstance = createFieldInstanceByRaw({
          ...updatedFieldRaw,
          dbFieldType,
          cellValueType,
          isMultipleCellValue: isMultipleCellValue ?? null,
        });

        // Build table name map for link field operations
        const tableNameMap = await this.linkFieldQueryService.getTableNameMapForLinkFields(
          targetTableId,
          [fieldInstance]
        );

        // Check if we need link context
        const needsLinkContext = fieldInstance.type === FieldType.Link && !fieldInstance.isLookup;
        const linkContext = needsLinkContext ? { tableId: targetTableId, tableNameMap } : undefined;

        const modifyColumnSql = this.dbProvider.modifyColumnSchema(
          dbTableName,
          fieldInstance,
          fieldInstance,
          tableDomain,
          linkContext
        );

        for (const alterTableQuery of modifyColumnSql) {
          this.logger.debug(
            "Executing SQL to modify primary formula field's column: " + alterTableQuery
          );
          await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
        }
        await this.prismaService.txClient().field.update({
          where: {
            id: fieldMap[id],
          },
          data: {
            cellValueType,
            dbFieldType,
            isMultipleCellValue,
          },
        });
      }
    }
  }

  async repairFormulaReference(
    formulaFields: IFieldWithTableIdJson[],
    fieldMap: Record<string, string>
  ) {
    // [toFieldId, [fromFieldId][]]
    const referenceFields = [] as [string, string[]][];
    for (const field of formulaFields) {
      const formulaOptions = field.options as IFormulaFieldOptions;
      const expressionFields = extractFieldReferences(formulaOptions.expression);
      const existedFields = expressionFields
        .filter((fieldId) => fieldMap[fieldId])
        .map((fieldId) => fieldMap[fieldId]);
      const currentFieldId = fieldMap[field.id];
      if (currentFieldId && existedFields.length > 0) {
        referenceFields.push([currentFieldId, existedFields]);
      }
    }

    const referenceRows = referenceFields
      .flatMap(([toFieldId, fromFieldIds]) =>
        fromFieldIds.map((fromFieldId) => ({ fromFieldId, toFieldId }))
      )
      .filter(
        (row, index, list) =>
          list.findIndex(
            (other) => other.fromFieldId === row.fromFieldId && other.toFieldId === row.toFieldId
          ) === index
      );

    if (referenceRows.length) {
      await this.prismaService.txClient().reference.createMany({
        data: referenceRows,
        skipDuplicates: true,
      });
    }
  }

  async createLinkFields(
    // filter lookup fields
    linkFields: IFieldWithTableIdJson[],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    fkMap: Record<string, string>
  ) {
    const selfLinkFields = linkFields.filter(
      ({ options, sourceTableId }) =>
        (options as ILinkFieldOptions).foreignTableId === sourceTableId
    );

    // cross base link fields should convert to one-way link field
    // only for base-duplicate
    const crossBaseLinkFields = linkFields
      .filter(({ options }) => Boolean((options as ILinkFieldOptions)?.baseId))
      .map((f) => ({
        ...f,
        options: {
          ...f.options,
          isOneWay: true,
        },
      })) as IFieldWithTableIdJson[];

    // already converted to text field in export side, prevent unexpected error
    // if (crossBaseLinkFields.length > 0) {
    //   throw new BadRequestException('cross base link fields are not supported');
    // }

    // common cross table link fields
    const commonLinkFields = linkFields.filter(
      ({ id }) => ![...selfLinkFields, ...crossBaseLinkFields].map(({ id }) => id).includes(id)
    );

    await this.createSelfLinkFields(selfLinkFields, fieldMap, fkMap);

    // deal with cross base link fields
    await this.createCommonLinkFields(crossBaseLinkFields, tableIdMap, fieldMap, fkMap, true);

    await this.createCommonLinkFields(commonLinkFields, tableIdMap, fieldMap, fkMap);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async createSelfLinkFields(
    fields: IFieldWithTableIdJson[],
    fieldMap: Record<string, string>,
    fkMap: Record<string, string>
  ) {
    const twoWaySelfLinkFields = fields.filter(
      ({ options }) => !(options as ILinkFieldOptions).isOneWay
    );

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

    const oneWaySelfLinkFields = fields.filter(
      ({ options }) => (options as ILinkFieldOptions).isOneWay
    );

    const oneWayByTable = new Map<string, IFieldWithTableIdJson[]>();
    for (const field of oneWaySelfLinkFields) {
      const list = oneWayByTable.get(field.targetTableId) ?? [];
      list.push(field);
      oneWayByTable.set(field.targetTableId, list);
    }

    for (const [targetTableId, tableFields] of oneWayByTable.entries()) {
      const fieldRos: IFieldRo[] = tableFields.map(
        ({ name, type, options, description, dbFieldName }) => ({
          name,
          type,
          dbFieldName,
          description,
          options: {
            foreignTableId: targetTableId,
            relationship: (options as ILinkFieldOptions).relationship,
            isOneWay: true,
          },
        })
      );

      const newFieldVos = await this.fieldOpenApiService.createFieldsByRo(targetTableId, fieldRos);

      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });

      for (let index = 0; index < tableFields.length; index++) {
        const original = tableFields[index];
        const newFieldVo = newFieldVos[index];
        await this.replenishmentConstraint(
          newFieldVo.id,
          targetTableId,
          original.order,
          {
            notNull: original.notNull,
            unique: original.unique,
            dbFieldName: newFieldVo.dbFieldName,
            isPrimary: original.isPrimary,
          },
          dbTableName
        );
        fieldMap[original.id] = newFieldVo.id;
        if ((original.options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
          fkMap[(original.options as ILinkFieldOptions).selfKeyName] = (
            newFieldVo.options as ILinkFieldOptions
          ).selfKeyName;
        }
      }
    }

    const twoWayByTable = new Map<
      string,
      Array<{ driverField: IFieldWithTableIdJson; groupField: IFieldWithTableIdJson }>
    >();
    for (const pair of mergedTwoWaySelfLinkFields) {
      const index = pair.findIndex((f) => (f.options as ILinkFieldOptions).isOneWay === undefined)!;
      const passiveIndex = index === -1 ? 0 : index;
      const driverIndex = passiveIndex === 0 ? 1 : 0;

      const groupField = pair[passiveIndex];
      const driverField = pair[driverIndex];
      const list = twoWayByTable.get(driverField.targetTableId) ?? [];
      list.push({ driverField, groupField });
      twoWayByTable.set(driverField.targetTableId, list);
    }

    for (const [targetTableId, pairs] of twoWayByTable.entries()) {
      const fieldRos: IFieldRo[] = pairs.map(({ driverField }) => {
        const options = driverField.options as ILinkFieldOptions;
        return {
          type: driverField.type as FieldType,
          dbFieldName: driverField.dbFieldName,
          name: driverField.name,
          description: driverField.description,
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
        };
      });

      const newFieldVos = await this.fieldOpenApiService.createFieldsByRo(targetTableId, fieldRos);

      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });

      for (let index = 0; index < pairs.length; index++) {
        const { driverField, groupField } = pairs[index];
        const newFieldVo = newFieldVos[index];
        await this.replenishmentConstraint(
          newFieldVo.id,
          targetTableId,
          driverField.order,
          {
            notNull: driverField.notNull,
            unique: driverField.unique,
            dbFieldName: newFieldVo.dbFieldName,
            isPrimary: driverField.isPrimary,
          },
          dbTableName
        );
        fieldMap[driverField.id] = newFieldVo.id;
        if ((driverField.options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
          fkMap[(driverField.options as ILinkFieldOptions).selfKeyName] = (
            newFieldVo.options as ILinkFieldOptions
          ).selfKeyName;
        }

        const symmetricFieldId = (newFieldVo.options as ILinkFieldOptions).symmetricFieldId!;
        fieldMap[groupField.id] = symmetricFieldId;
        await this.repairSymmetricField(groupField, targetTableId, symmetricFieldId, dbTableName);
      }
    }
  }

  async createCommonLinkFields(
    fields: IFieldWithTableIdJson[],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    fkMap: Record<string, string>,
    allowCrossBase: boolean = false
  ) {
    const oneWayFields = fields.filter(({ options }) => (options as ILinkFieldOptions).isOneWay);
    const twoWayFields = fields.filter(({ options }) => !(options as ILinkFieldOptions).isOneWay);

    const oneWayByTable = new Map<string, IFieldWithTableIdJson[]>();
    for (const field of oneWayFields) {
      const list = oneWayByTable.get(field.targetTableId) ?? [];
      list.push(field);
      oneWayByTable.set(field.targetTableId, list);
    }

    for (const [targetTableId, tableFields] of oneWayByTable.entries()) {
      const fieldRos: IFieldRo[] = tableFields.map(
        ({ name, type, options, description, dbFieldName }) => {
          const { foreignTableId, relationship } = options as ILinkFieldOptions;
          return {
            name,
            type,
            description,
            dbFieldName,
            options: {
              foreignTableId: allowCrossBase ? foreignTableId : tableIdMap[foreignTableId],
              relationship,
              isOneWay: true,
            },
          };
        }
      );

      const newFieldVos = await this.fieldOpenApiService.createFieldsByRo(targetTableId, fieldRos);

      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });

      for (let index = 0; index < tableFields.length; index++) {
        const original = tableFields[index];
        const newFieldVo = newFieldVos[index];
        fieldMap[original.id] = newFieldVo.id;
        if ((original.options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
          fkMap[(original.options as ILinkFieldOptions).selfKeyName] = (
            newFieldVo.options as ILinkFieldOptions
          ).selfKeyName;
        }
        await this.replenishmentConstraint(
          newFieldVo.id,
          targetTableId,
          original.order,
          {
            notNull: original.notNull,
            unique: original.unique,
            dbFieldName: newFieldVo.dbFieldName,
            isPrimary: original.isPrimary,
          },
          dbTableName
        );
      }
    }

    const groupedTwoWayFields = [] as [IFieldWithTableIdJson, IFieldWithTableIdJson][];

    twoWayFields.forEach((f) => {
      // two-way link field should only create one of it
      if (!groupedTwoWayFields.some((group) => group.some(({ id: fId }) => fId === f.id))) {
        const symmetricField = twoWayFields.find(
          ({ options }) => get(options, 'symmetricFieldId') === f.id
        );
        symmetricField && groupedTwoWayFields.push([f, symmetricField]);
      }
    });

    const twoWayByTable = new Map<
      string,
      Array<{ passiveField: IFieldWithTableIdJson; symmetricField: IFieldWithTableIdJson }>
    >();
    for (const pair of groupedTwoWayFields) {
      // fk would like in this table
      const index = pair.findIndex((f) => (f.options as ILinkFieldOptions).isOneWay === undefined)!;
      const passiveIndex = index === -1 ? 0 : index;
      const driverIndex = passiveIndex === 0 ? 1 : 0;
      const passiveField = pair[passiveIndex];
      const symmetricField = pair[driverIndex];
      const list = twoWayByTable.get(passiveField.targetTableId) ?? [];
      list.push({ passiveField, symmetricField });
      twoWayByTable.set(passiveField.targetTableId, list);
    }

    for (const [targetTableId, pairs] of twoWayByTable.entries()) {
      const fieldRos: IFieldRo[] = pairs.map(({ passiveField }) => {
        const { foreignTableId, relationship } = passiveField.options as ILinkFieldOptions;
        return {
          name: passiveField.name,
          type: passiveField.type as FieldType,
          description: passiveField.description,
          dbFieldName: passiveField.dbFieldName,
          options: {
            foreignTableId: tableIdMap[foreignTableId],
            relationship,
            isOneWay: false,
          },
        };
      });

      const newFieldVos = await this.fieldOpenApiService.createFieldsByRo(targetTableId, fieldRos);

      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });

      for (let index = 0; index < pairs.length; index++) {
        const { passiveField, symmetricField } = pairs[index];
        const newFieldVo = newFieldVos[index];
        fieldMap[passiveField.id] = newFieldVo.id;
        const symmetricFieldId = (newFieldVo.options as ILinkFieldOptions).symmetricFieldId!;
        fieldMap[symmetricField.id] = symmetricFieldId;
        if ((passiveField.options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
          fkMap[(passiveField.options as ILinkFieldOptions).selfKeyName] = (
            newFieldVo.options as ILinkFieldOptions
          ).selfKeyName;
        }
        await this.replenishmentConstraint(
          newFieldVo.id,
          targetTableId,
          passiveField.order,
          {
            notNull: passiveField.notNull,
            unique: passiveField.unique,
            dbFieldName: newFieldVo.dbFieldName,
            isPrimary: passiveField.isPrimary,
          },
          dbTableName
        );
        await this.repairSymmetricField(
          symmetricField,
          (newFieldVo.options as ILinkFieldOptions).foreignTableId,
          symmetricFieldId
        );
      }
    }
  }

  // create two-way link, the symmetricFieldId created automatically, and need to update config
  async repairSymmetricField(
    symmetricField: IFieldWithTableIdJson,
    targetTableId: string,
    newFieldId: string,
    targetDbTableName?: string
  ) {
    const { notNull, unique, dbFieldName, isPrimary, description, name, order } = symmetricField;
    const { dbTableName: resolvedDbTableName } = targetDbTableName
      ? { dbTableName: targetDbTableName }
      : await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
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
      const exists = await this.dbProvider.checkColumnExist(
        resolvedDbTableName,
        genDbFieldName,
        this.prismaService.txClient()
      );
      if (exists) {
        // Debug logging for rename operation to diagnose failures
        // eslint-disable-next-line no-console
        console.log('[repairSymmetricField] renameColumn info', {
          targetDbTableName: resolvedDbTableName,
          genDbFieldName,
          desiredDbFieldName: dbFieldName,
          symmetricFieldId: newFieldId,
        });
        const alterTableSql = this.dbProvider.renameColumn(
          resolvedDbTableName,
          genDbFieldName,
          dbFieldName
        );

        for (const sql of alterTableSql) {
          // eslint-disable-next-line no-console
          console.log('[repairSymmetricField] executing SQL', sql);
          await this.prismaService.txClient().$executeRawUnsafe(sql);
        }
      }
    }

    await this.replenishmentConstraint(
      newFieldId,
      targetTableId,
      order,
      {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      },
      resolvedDbTableName
    );
  }

  async repairFieldOptions(
    tables: IBaseJson['tables'],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();

    const sourceFields = tables.map(({ fields }) => fields).flat();

    const targetFieldRaws = await prisma.field.findMany({
      where: {
        id: { in: Object.values(fieldIdMap) },
      },
    });

    const targetFields = targetFieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));

    const linkFields = targetFields.filter(
      (field) => field.type === FieldType.Link && !field.isLookup
    );
    const lookupFields = targetFields.filter((field) => field.isLookup);
    const rollupFields = targetFields.filter((field) => field.type === FieldType.Rollup);
    const conditionalRollupFields = targetFields.filter(
      (field) => field.type === FieldType.ConditionalRollup
    );

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
    for (const field of conditionalRollupFields) {
      const { options, id } = field;
      const newOptions = replaceStringByMap(options, { tableIdMap, fieldIdMap, viewIdMap }, false);

      await prisma.field.update({
        where: { id },
        data: { options: JSON.stringify(newOptions) },
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

  /* eslint-disable sonarjs/cognitive-complexity */
  async createDependencyFields(
    dependFields: IFieldWithTableIdJson[],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    scope: 'base' | 'table' = 'base'
  ): Promise<void> {
    if (!dependFields.length) return;

    const maxCount = dependFields.length * 10;

    const checkedField = [] as IFieldJson[];

    const countMap = {} as Record<string, number>;

    while (dependFields.length) {
      const curField = dependFields.shift();
      if (!curField) continue;

      const { sourceTableId, targetTableId } = curField;

      const isChecked = checkedField.some((f) => f.id === curField.id);
      // InDegree all ready
      const isInDegreeReady = await this.isInDegreeReady(curField, fieldMap, scope);

      if (isInDegreeReady) {
        await this.duplicateSingleDependField(
          sourceTableId,
          targetTableId,
          curField,
          tableIdMap,
          fieldMap,
          scope
        );
        continue;
      }

      if (isChecked) {
        if (curField.hasError) {
          await this.duplicateSingleDependField(
            sourceTableId,
            targetTableId,
            curField,
            tableIdMap,
            fieldMap,
            scope,
            true
          );
        } else if (!countMap[curField.id] || countMap[curField.id] < maxCount) {
          dependFields.push(curField);
          checkedField.push(curField);
          countMap[curField.id] = (countMap[curField.id] || 0) + 1;
        } else {
          throw new CustomHttpException(
            `Create circular field when create field: ${curField.name}[${curField.id}]`,
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.field.cycleDetectedCreateField',
                context: {
                  id: curField.id,
                  name: curField.name,
                },
              },
            }
          );
        }
      } else {
        dependFields.push(curField);
        checkedField.push(curField);
      }
    }
  }

  async duplicateSingleDependField(
    sourceTableId: string,
    targetTableId: string,
    field: IFieldWithTableIdJson,
    tableIdMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>,
    scope: 'base' | 'table' = 'base',
    hasError = false
  ) {
    const hasFieldError = Boolean(field.hasError);
    const isAiConfig = field.aiConfig && !field.isLookup;
    const isLookup = field.isLookup;
    const isRollup = field.type === FieldType.Rollup && !field.isLookup;
    const isConditionalRollup = field.type === FieldType.ConditionalRollup;
    const isFormula = field.type === FieldType.Formula && !field.isLookup;
    const shouldConvertErroredComputed =
      scope === 'base' && hasFieldError && (isLookup || isRollup || isConditionalRollup);

    if (shouldConvertErroredComputed) {
      // During base import, persist errored computed fields as plain text so users keep the data.
      await this.duplicateErroredComputedFieldAsText(targetTableId, field, sourceToTargetFieldMap);
      return;
    }

    switch (true) {
      case isLookup:
        await this.duplicateLookupField(
          sourceTableId,
          targetTableId,
          field,
          tableIdMap,
          sourceToTargetFieldMap
        );
        break;
      case isAiConfig:
        await this.duplicateFieldAiConfig(
          targetTableId,
          field as unknown as IFieldInstance,
          sourceToTargetFieldMap
        );
        break;
      case isRollup:
        await this.duplicateRollupField(
          sourceTableId,
          targetTableId,
          field,
          tableIdMap,
          sourceToTargetFieldMap
        );
        break;
      case isConditionalRollup:
        await this.duplicateConditionalRollupField(
          sourceTableId,
          targetTableId,
          field,
          tableIdMap,
          sourceToTargetFieldMap
        );
        break;
      case isFormula:
        await this.duplicateFormulaField(
          targetTableId,
          field,
          sourceToTargetFieldMap,
          hasError || hasFieldError
        );
    }
  }

  private async duplicateErroredComputedFieldAsText(
    targetTableId: string,
    field: IFieldWithTableIdJson,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const { id, name, description, dbFieldName, order, notNull, unique, isPrimary } = field;

    const createFieldRo: IFieldRo = {
      type: FieldType.SingleLineText,
      name,
      description,
    };

    if (dbFieldName) {
      createFieldRo.dbFieldName = dbFieldName;
    }

    const newField = await this.fieldOpenApiService.createField(targetTableId, createFieldRo);

    await this.replenishmentConstraint(newField.id, targetTableId, order, {
      notNull,
      unique,
      dbFieldName: newField.dbFieldName,
      isPrimary,
    });

    sourceToTargetFieldMap[id] = newField.id;
  }

  async duplicateLookupField(
    sourceTableId: string,
    targetTableId: string,
    field: IFieldWithTableIdJson,
    tableIdMap: Record<string, string>,
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
      type: lookupFieldType,
      isConditionalLookup,
    } = field;

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
    let newField;

    const lookupOptionsRo = lookupOptions as ILookupOptionsRo | undefined;

    if (isConditionalLookup) {
      const conditionalOptions = isConditionalLookupOptions(lookupOptionsRo)
        ? (lookupOptionsRo as IConditionalLookupOptions)
        : undefined;
      const originalForeignTableId = conditionalOptions?.foreignTableId;
      const originalLookupFieldId = conditionalOptions?.lookupFieldId;
      const mappedForeignTableId = originalForeignTableId
        ? originalForeignTableId === sourceTableId
          ? targetTableId
          : tableIdMap[originalForeignTableId] || originalForeignTableId
        : undefined;
      const mappedLookupFieldId = originalLookupFieldId
        ? sourceToTargetFieldMap[originalLookupFieldId] || originalLookupFieldId
        : undefined;
      const remappedLookupOptions = conditionalOptions
        ? (replaceStringByMap(
            conditionalOptions,
            { tableIdMap, fieldIdMap: sourceToTargetFieldMap },
            false
          ) as IConditionalLookupOptions)
        : undefined;

      if (!mappedForeignTableId || !(hasError || mappedLookupFieldId)) {
        throw new BadGatewayException(
          'Unable to resolve conditional lookup references during duplication'
        );
      }

      const effectiveLookupFieldId = hasError ? mockFieldId : (mappedLookupFieldId as string);

      newField = await this.fieldOpenApiService.createField(targetTableId, {
        type: (hasError ? mockType : lookupFieldType) as FieldType,
        dbFieldName,
        description,
        isLookup: true,
        isConditionalLookup: true,
        name,
        options,
        lookupOptions: {
          baseId: remappedLookupOptions?.baseId ?? conditionalOptions?.baseId,
          foreignTableId: remappedLookupOptions?.foreignTableId ?? mappedForeignTableId,
          lookupFieldId: effectiveLookupFieldId,
          filter: remappedLookupOptions?.filter ?? conditionalOptions?.filter ?? null,
          sort: remappedLookupOptions?.sort ?? conditionalOptions?.sort ?? undefined,
          limit: remappedLookupOptions?.limit ?? conditionalOptions?.limit ?? undefined,
        },
      });

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
              lookupFieldId: conditionalOptions?.lookupFieldId,
              filter: conditionalOptions?.filter ?? null,
              sort: conditionalOptions?.sort ?? undefined,
              limit: conditionalOptions?.limit ?? undefined,
            }),
            options: JSON.stringify(options),
          },
        });
      }
    } else {
      if (!lookupOptionsRo || !isLinkLookupOptions(lookupOptionsRo)) {
        throw new BadGatewayException(
          'Lookup options missing link configuration during duplication'
        );
      }

      const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptionsRo;
      const isSelfLink = foreignTableId === sourceTableId;

      newField = await this.fieldOpenApiService.createField(targetTableId, {
        type: (hasError ? mockType : lookupFieldType) as FieldType,
        dbFieldName,
        description,
        isLookup: true,
        lookupOptions: {
          foreignTableId:
            (isSelfLink ? targetTableId : tableIdMap[foreignTableId]) || foreignTableId,
          linkFieldId: sourceToTargetFieldMap[linkFieldId],
          lookupFieldId: isSelfLink
            ? hasError
              ? mockFieldId
              : sourceToTargetFieldMap[lookupFieldId]
            : hasError
              ? mockFieldId
              : sourceToTargetFieldMap[lookupFieldId] || lookupFieldId,
        },
        name,
      });

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
              lookupFieldId,
            }),
            options: JSON.stringify(options),
          },
        });
      }
    }
    await this.replenishmentConstraint(newField.id, targetTableId, field.order, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    });
    sourceToTargetFieldMap[id] = newField.id;
  }

  async duplicateRollupField(
    sourceTableId: string,
    targetTableId: string,
    fieldInstance: IFieldWithTableIdJson,
    tableIdMap: Record<string, string>,
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
      type: lookupFieldType,
    } = fieldInstance;
    if (!lookupOptions || !isLinkLookupOptions(lookupOptions)) {
      throw new BadGatewayException('Rollup field without link lookup options during duplication');
    }
    const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptions;
    const isSelfLink = foreignTableId === sourceTableId;

    const mockFieldId = Object.values(sourceToTargetFieldMap)[0];
    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type: FieldType.Rollup,
      dbFieldName,
      description,
      lookupOptions: {
        // foreignTableId may are cross base table id, so we need to use tableIdMap to get the target table id
        foreignTableId: (isSelfLink ? targetTableId : tableIdMap[foreignTableId]) || foreignTableId,
        linkFieldId: sourceToTargetFieldMap[linkFieldId],
        lookupFieldId: isSelfLink
          ? hasError
            ? mockFieldId
            : sourceToTargetFieldMap[lookupFieldId]
          : hasError
            ? mockFieldId
            : sourceToTargetFieldMap[lookupFieldId] || lookupFieldId,
      },
      options,
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, fieldInstance.order, {
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

  async duplicateConditionalRollupField(
    _sourceTableId: string,
    targetTableId: string,
    fieldInstance: IFieldWithTableIdJson,
    tableIdMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const {
      dbFieldName,
      name,
      id,
      hasError,
      options,
      notNull,
      unique,
      description,
      isPrimary,
      type,
    } = fieldInstance;

    const referenceOptions = options as IConditionalRollupFieldOptions;
    const mockFieldId = Object.values(sourceToTargetFieldMap)[0];

    const remappedOptions = replaceStringByMap(
      {
        ...referenceOptions,
        foreignTableId:
          tableIdMap[referenceOptions.foreignTableId!] || referenceOptions.foreignTableId,
        lookupFieldId: hasError
          ? mockFieldId
          : sourceToTargetFieldMap[referenceOptions.lookupFieldId!] ||
            referenceOptions.lookupFieldId,
      },
      { tableIdMap, fieldIdMap: sourceToTargetFieldMap },
      false
    ) as IConditionalRollupFieldOptions;

    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type: FieldType.ConditionalRollup,
      dbFieldName,
      description,
      options: remappedOptions,
      name,
    });

    await this.replenishmentConstraint(newField.id, targetTableId, fieldInstance.order, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    });

    sourceToTargetFieldMap[id] = newField.id;

    if (hasError) {
      await this.prismaService.txClient().field.update({
        where: { id: newField.id },
        data: {
          hasError,
          type,
          options: JSON.stringify(options),
        },
      });
    }
  }

  async duplicateFormulaField(
    targetTableId: string,
    fieldInstance: IFieldWithTableIdJson,
    sourceToTargetFieldMap: Record<string, string>,
    hasError: boolean = false
  ) {
    const {
      type,
      dbFieldName,
      name,
      options,
      id,
      notNull,
      unique,
      description,
      isPrimary,
      dbFieldType,
      cellValueType,
      isMultipleCellValue,
    } = fieldInstance;
    const { expression } = options as IFormulaFieldOptions;
    const newExpression = replaceStringByMap(expression, { sourceToTargetFieldMap });
    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type,
      dbFieldName,
      description,
      options: {
        ...options,
        expression: hasError
          ? DEFAULT_EXPRESSION
          : newExpression
            ? JSON.parse(newExpression)
            : undefined,
      },
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, fieldInstance.order, {
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
          // error formulas should not be persisted as generated columns
          meta: null,
        },
      });
    }

    if (dbFieldType !== newField.dbFieldType) {
      const tableDomain = await this.tableDomainQueryService.getTableDomainById(targetTableId);
      const { dbTableName } = tableDomain;

      // Create field instance for the updated field
      const updatedFieldRaw = await this.prismaService.txClient().field.findUniqueOrThrow({
        where: { id: newField.id },
      });
      const fieldInstance = createFieldInstanceByRaw({
        ...updatedFieldRaw,
        dbFieldType,
        cellValueType,
        isMultipleCellValue: isMultipleCellValue ?? null,
      });

      // Build table name map for link field operations
      const tableNameMap = await this.linkFieldQueryService.getTableNameMapForLinkFields(
        targetTableId,
        [fieldInstance]
      );

      // Check if we need link context
      const needsLinkContext = fieldInstance.type === FieldType.Link && !fieldInstance.isLookup;
      const linkContext = needsLinkContext ? { tableId: targetTableId, tableNameMap } : undefined;

      const modifyColumnSql = this.dbProvider.modifyColumnSchema(
        dbTableName,
        fieldInstance,
        fieldInstance,
        tableDomain,
        linkContext
      );

      for (const alterTableQuery of modifyColumnSql) {
        await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
      }

      await this.prismaService.txClient().field.update({
        where: {
          id: newField.id,
        },
        data: {
          dbFieldType,
          cellValueType,
          isMultipleCellValue,
        },
      });
    }
  }

  private async duplicateFieldAiConfig(
    targetTableId: string,
    fieldInstance: IFieldInstance,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    if (!fieldInstance.aiConfig) return;

    const { type, dbFieldName, name, options, id, notNull, unique, description, isPrimary } =
      fieldInstance;

    const aiConfig: IFieldVo['aiConfig'] = { ...fieldInstance.aiConfig };

    if ('sourceFieldId' in aiConfig) {
      aiConfig.sourceFieldId = sourceToTargetFieldMap[aiConfig.sourceFieldId as string];
    }

    if ('prompt' in aiConfig) {
      Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
        aiConfig.prompt = aiConfig.prompt.replaceAll(key, value);
      });
    }

    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type,
      dbFieldName,
      description,
      options,
      aiConfig,
      name,
    });

    await this.replenishmentConstraint(newField.id, targetTableId, 1, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    });
    sourceToTargetFieldMap[id] = newField.id;
  }

  // field could not set constraint when create
  async replenishmentConstraint(
    fId: string,
    targetTableId: string,
    order: number,
    {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    }: { notNull?: boolean; unique?: boolean; dbFieldName: string; isPrimary?: boolean },
    dbTableName?: string
  ) {
    await this.prismaService.txClient().field.update({
      where: {
        id: fId,
      },
      data: {
        order,
      },
    });
    if (!notNull && !unique && !isPrimary) {
      return;
    }

    const resolvedDbTableName =
      dbTableName ??
      (
        await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
          where: {
            id: targetTableId,
          },
          select: {
            dbTableName: true,
          },
        })
      ).dbTableName;

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
      const fieldValidationSqls = this.knex.schema
        .alterTable(resolvedDbTableName, (table) => {
          if (unique)
            table.unique([dbFieldName], {
              indexName: this.fieldOpenApiService.getFieldUniqueKeyName(
                resolvedDbTableName,
                dbFieldName,
                fId
              ),
            });
          if (notNull) table.dropNullable(dbFieldName);
        })
        .toSQL();

      for (const sql of fieldValidationSqls) {
        // skip sqlite pragma
        if (sql.sql.startsWith('PRAGMA')) {
          continue;
        }
        await this.prismaService.txClient().$executeRawUnsafe(sql.sql);
      }
    }
  }

  private async isInDegreeReady(
    field: IFieldWithTableIdJson,
    fieldMap: Record<string, string>,
    scope: 'base' | 'table' = 'base'
  ) {
    const { isLookup, type, isConditionalLookup } = field;
    if (field.aiConfig) {
      const { aiConfig } = field;

      if ('sourceFieldId' in aiConfig) {
        return Boolean(fieldMap[aiConfig.sourceFieldId]);
      }

      if ('prompt' in aiConfig) {
        const { prompt } = aiConfig;
        const fieldIds = extractFieldReferences(prompt);
        const keys = Object.keys(fieldMap);
        return fieldIds.every((field) => keys.includes(field));
      }
    }

    if (type === FieldType.Formula && !isLookup) {
      const formulaOptions = field.options as IFormulaFieldOptions;
      const referencedFields = this.extractFieldIds(formulaOptions.expression);
      const keys = Object.keys(fieldMap);
      return referencedFields.every((field) => keys.includes(field));
    }

    if (type === FieldType.ConditionalRollup) {
      const options = field.options as IConditionalRollupFieldOptions | undefined;
      if (!options) {
        return false;
      }

      if (options.baseId) {
        return true;
      }

      const dependencies = this.collectConditionalDependencies({
        lookupFieldId: options.lookupFieldId,
        filter: options.filter,
        sortFieldId: options.sort?.fieldId,
      });
      return this.areDependenciesResolved(fieldMap, dependencies);
    }

    if (isLookup && isConditionalLookup) {
      const lookupOptions = field.lookupOptions as IConditionalLookupOptions | undefined;
      if (!lookupOptions) {
        return false;
      }

      if (lookupOptions.baseId) {
        return true;
      }

      const dependencies = this.collectConditionalDependencies({
        lookupFieldId: lookupOptions.lookupFieldId,
        filter: lookupOptions.filter,
        sortFieldId: lookupOptions.sort?.fieldId,
      });
      return this.areDependenciesResolved(fieldMap, dependencies);
    }

    if (isLookup || type === FieldType.Rollup) {
      const { lookupOptions, sourceTableId } = field;
      if (!lookupOptions || !isLinkLookupOptions(lookupOptions)) {
        return false;
      }
      const { linkFieldId, lookupFieldId, foreignTableId } = lookupOptions;
      const isSelfLink = foreignTableId === sourceTableId;
      const linkField = await this.prismaService.txClient().field.findUnique({
        where: {
          id: linkFieldId,
        },
        select: {
          options: true,
        },
      });

      // if the cross base relative field is existed, the lookup or rollup field should be ready to create
      const linkFieldOptions = JSON.parse(
        linkField?.options || ('{}' as string)
      ) as ILinkFieldOptions;

      if (linkFieldOptions.baseId) {
        return true;
      }

      // duplicate table should not consider lookupFieldId when link field is not self link
      return scope === 'base' || isSelfLink
        ? Boolean(fieldMap[lookupFieldId] && fieldMap[linkFieldId])
        : fieldMap[linkFieldId];
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

  private collectConditionalDependencies({
    lookupFieldId,
    filter,
    sortFieldId,
  }: {
    lookupFieldId?: string | null;
    filter?: IFilter | null;
    sortFieldId?: string | null;
  }): string[] {
    const dependencies = new Set<string>();

    if (lookupFieldId) {
      dependencies.add(lookupFieldId);
    }

    extractFieldIdsFromFilter(filter || undefined, true).forEach((fieldId) => {
      dependencies.add(fieldId);
    });

    if (sortFieldId) {
      dependencies.add(sortFieldId);
    }

    return [...dependencies];
  }

  private areDependenciesResolved(
    fieldMap: Record<string, string>,
    dependencies: string[]
  ): boolean {
    if (!dependencies.length) {
      return true;
    }

    const knownFieldIds = new Set(Object.keys(fieldMap));
    return dependencies.every((fieldId) => knownFieldIds.has(fieldId));
  }
}
