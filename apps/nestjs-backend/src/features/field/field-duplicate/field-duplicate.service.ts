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
import type { IBaseJson, IFieldWithTableIdJson } from '@teable/openapi';
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
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, field.order, {
        notNull,
        unique,
        dbFieldName: newFieldVo.dbFieldName,
        isPrimary,
      });
      fieldMap[field.id] = newFieldVo.id;
      await this.prismaService.txClient().field.update({
        where: {
          id: newFieldVo.id,
        },
        data: {
          order: field.order,
        },
      });
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
    for (const field of primaryFormulaFields) {
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
        targetTableId,
        order,
        hasError,
      } = field;
      const newField = await this.fieldOpenApiService.createField(targetTableId, {
        type,
        dbFieldName,
        description,
        options: {
          // ...options,
          expression: DEFAULT_EXPRESSION,
          timeZone: (options as IFormulaFieldOptions).timeZone,
        },
        name,
      });
      // Ensure meta is present for Postgres generated columns
      // In duplication flow, we use a safe default expression that is supported as generated column
      // Explicitly persist meta to satisfy consumers expecting it on error formulas
      if (newField.meta) {
        await this.prismaService.txClient().field.update({
          where: { id: newField.id },
          data: { meta: JSON.stringify(newField.meta) },
        });
      }
      await this.replenishmentConstraint(newField.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      fieldMap[id] = newField.id;

      if (hasError) {
        await this.prismaService.txClient().field.update({
          where: {
            id: newField.id,
          },
          data: {
            hasError,
            // error formulas should not be persisted as generated columns
            meta: null,
          },
        });
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

    for (const [toFieldId, fromFieldIds] of referenceFields) {
      for (const fromFieldId of fromFieldIds) {
        await this.prismaService.txClient().reference.createMany({
          data: [
            {
              fromFieldId,
              toFieldId,
            },
          ],
        });
      }
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
        dbFieldName,
        description,
        options: {
          foreignTableId: targetTableId,
          relationship,
          isOneWay: true,
        },
      });
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, field.order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      fieldMap[field.id] = newFieldVo.id;
      if ((field.options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
        fkMap[(field.options as ILinkFieldOptions).selfKeyName] = (
          newFieldVo.options as ILinkFieldOptions
        ).selfKeyName;
      }
    }

    for (const field of mergedTwoWaySelfLinkFields) {
      const index = field.findIndex(
        (f) => (f.options as ILinkFieldOptions).isOneWay === undefined
      )!;
      const passiveIndex = index === -1 ? 0 : index;
      const driverIndex = passiveIndex === 0 ? 1 : 0;

      const groupField = field[passiveIndex];
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
        order,
      } = field[driverIndex];
      const options = field[driverIndex].options as ILinkFieldOptions;
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
      await this.replenishmentConstraint(newField.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      fieldMap[id] = newField.id;
      if ((options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
        fkMap[(options as ILinkFieldOptions).selfKeyName] = (
          newField.options as ILinkFieldOptions
        ).selfKeyName;
      }
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
          order: groupField.order,
        },
      });

      if (genDbFieldName !== groupField.dbFieldName) {
        const exists = await this.dbProvider.checkColumnExist(
          targetDbTableName,
          genDbFieldName,
          this.prismaService.txClient()
        );
        if (exists) {
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
        dbFieldName,
        options: {
          foreignTableId: allowCrossBase ? foreignTableId : tableIdMap[foreignTableId],
          relationship,
          isOneWay: true,
        },
      });
      fieldMap[field.id] = newFieldVo.id;
      if ((field.options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
        fkMap[(field.options as ILinkFieldOptions).selfKeyName] = (
          newFieldVo.options as ILinkFieldOptions
        ).selfKeyName;
      }
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, field.order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
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

    for (const field of groupedTwoWayFields) {
      // fk would like in this table
      const index = field.findIndex(
        (f) => (f.options as ILinkFieldOptions).isOneWay === undefined
      )!;
      const passiveIndex = index === -1 ? 0 : index;
      const driverIndex = passiveIndex === 0 ? 1 : 0;
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
        order,
      } = field[passiveIndex];
      const symmetricField = field[driverIndex];
      const { foreignTableId, relationship } = options as ILinkFieldOptions;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        description,
        dbFieldName,
        options: {
          foreignTableId: tableIdMap[foreignTableId],
          relationship,
          isOneWay: false,
        },
      });
      fieldMap[fieldId] = newFieldVo.id;
      fieldMap[symmetricField.id] = (newFieldVo.options as ILinkFieldOptions).symmetricFieldId!;
      if ((field[passiveIndex].options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
        fkMap[(field[passiveIndex].options as ILinkFieldOptions).selfKeyName] = (
          newFieldVo.options as ILinkFieldOptions
        ).selfKeyName;
      }
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, order, {
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

  // create two-way link, the symmetricFieldId created automatically, and need to update config
  async repairSymmetricField(
    symmetricField: IFieldWithTableIdJson,
    targetTableId: string,
    newFieldId: string
  ) {
    const { notNull, unique, dbFieldName, isPrimary, description, name, order } = symmetricField;
    await this.replenishmentConstraint(newFieldId, targetTableId, order, {
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
      const exists = await this.dbProvider.checkColumnExist(
        targetDbTableName,
        genDbFieldName,
        this.prismaService.txClient()
      );
      if (exists) {
        // Debug logging for rename operation to diagnose failures
        // eslint-disable-next-line no-console
        console.log('[repairSymmetricField] renameColumn info', {
          targetDbTableName,
          genDbFieldName,
          desiredDbFieldName: dbFieldName,
          symmetricFieldId: newFieldId,
        });
        const alterTableSql = this.dbProvider.renameColumn(
          targetDbTableName,
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

    const concurrency = this.getDependencyFieldCreateConcurrency();

    const existingFieldIds = Object.keys(fieldMap);
    const duplicatingFieldIds = new Set<string>([
      ...existingFieldIds,
      ...dependFields.map((f) => f.id),
    ]);
    const knownFieldIds = new Set<string>(existingFieldIds);

    const fieldById = new Map<string, IFieldWithTableIdJson>();
    const orderIndexById = new Map<string, number>();

    dependFields.forEach((field, index) => {
      fieldById.set(field.id, field);
      orderIndexById.set(field.id, index);
    });

    const dependentsByDependencyId = new Map<string, string[]>();
    const unresolvedCountByFieldId = new Map<string, number>();

    for (const field of dependFields) {
      const dependencies = this.getInternalDependencies(field, duplicatingFieldIds);
      let unresolved = 0;
      for (const depId of dependencies) {
        if (!knownFieldIds.has(depId)) {
          unresolved += 1;
        }
        const list = dependentsByDependencyId.get(depId);
        if (list) {
          list.push(field.id);
        } else {
          dependentsByDependencyId.set(depId, [field.id]);
        }
      }
      unresolvedCountByFieldId.set(field.id, unresolved);
    }

    const remainingIds = new Set<string>(dependFields.map((f) => f.id));

    let readyIds = dependFields
      .filter((f) => (unresolvedCountByFieldId.get(f.id) ?? 0) === 0)
      .map((f) => f.id);

    while (remainingIds.size) {
      let forcedErrorIds = new Set<string>();
      if (readyIds.length === 0) {
        const erroredIds = dependFields
          .filter((f) => remainingIds.has(f.id) && Boolean(f.hasError))
          .map((f) => f.id);

        if (erroredIds.length === 0) {
          const nextId = dependFields.find((f) => remainingIds.has(f.id))?.id;
          const curField = nextId ? fieldById.get(nextId) : undefined;
          throw new CustomHttpException(
            `Create circular field when create field: ${curField?.name ?? ''}[${curField?.id ?? ''}]`,
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.field.cycleDetectedCreateField',
                context: {
                  id: curField?.id,
                  name: curField?.name,
                },
              },
            }
          );
        }

        readyIds = erroredIds;
        forcedErrorIds = new Set<string>(erroredIds);
      }

      const currentLayerIds = readyIds;
      readyIds = [];
      const nextReadyIds = new Set<string>();

      const processFieldId = async (fieldId: string) => {
        if (!remainingIds.has(fieldId)) {
          return;
        }

        const field = fieldById.get(fieldId);
        if (!field) {
          remainingIds.delete(fieldId);
          return;
        }

        await this.duplicateSingleDependField(
          field.sourceTableId,
          field.targetTableId,
          field,
          tableIdMap,
          fieldMap,
          scope,
          forcedErrorIds.has(fieldId)
        );

        remainingIds.delete(fieldId);
        knownFieldIds.add(fieldId);

        const dependents = dependentsByDependencyId.get(fieldId) ?? [];
        for (const dependentId of dependents) {
          if (!remainingIds.has(dependentId)) {
            continue;
          }
          const nextUnresolved = (unresolvedCountByFieldId.get(dependentId) ?? 0) - 1;
          unresolvedCountByFieldId.set(dependentId, nextUnresolved);
          if (nextUnresolved === 0) {
            nextReadyIds.add(dependentId);
          }
        }
      };

      if (concurrency <= 1 || currentLayerIds.length <= 1) {
        for (const fieldId of currentLayerIds) {
          await processFieldId(fieldId);
        }
      } else {
        const layerGroupsByTableId = new Map<string, string[]>();
        for (const fieldId of currentLayerIds) {
          const field = fieldById.get(fieldId);
          const tableKey = field?.targetTableId ?? fieldId;
          const group = layerGroupsByTableId.get(tableKey);
          if (group) {
            group.push(fieldId);
          } else {
            layerGroupsByTableId.set(tableKey, [fieldId]);
          }
        }

        const groups = [...layerGroupsByTableId.values()].map((group) =>
          group.sort((a, b) => (orderIndexById.get(a) ?? 0) - (orderIndexById.get(b) ?? 0))
        );

        await this.runWithConcurrency(groups, concurrency, async (group) => {
          for (const fieldId of group) {
            await processFieldId(fieldId);
          }
        });
      }

      readyIds = [...nextReadyIds].sort(
        (a, b) => (orderIndexById.get(a) ?? 0) - (orderIndexById.get(b) ?? 0)
      );
    }
  }

  private getDependencyFieldCreateConcurrency(): number {
    const configured = Number(process.env.FIELD_DUPLICATE_FIELD_CREATE_CONCURRENCY ?? 5);
    const normalized = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5;

    const hasActiveTx = this.prismaService.txClient() !== this.prismaService;

    // Avoid concurrent Prisma queries within an interactive transaction by default.
    // Many duplicate/import flows run inside a single big transaction.
    // Opt-in (at your own risk) via FIELD_DUPLICATE_FIELD_CREATE_CONCURRENCY_IN_TX.
    if (hasActiveTx) {
      const configuredInTx = process.env.FIELD_DUPLICATE_FIELD_CREATE_CONCURRENCY_IN_TX;
      if (configuredInTx == null || configuredInTx === '') {
        return 1;
      }
      const inTx = Number(configuredInTx);
      return Number.isFinite(inTx) && inTx > 0 ? Math.floor(inTx) : 1;
    }

    return normalized;
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    if (!items.length) return;

    const limit = Math.max(1, Math.floor(concurrency));
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) {
          return;
        }
        await worker(items[index]);
      }
    });

    await Promise.all(workers);
  }

  private getInternalDependencies(
    field: IFieldWithTableIdJson,
    duplicatingFieldIds: Set<string>
  ): Set<string> {
    const dependencies = new Set<string>();

    if (field.aiConfig) {
      const { aiConfig } = field;

      if ('sourceFieldId' in aiConfig && aiConfig.sourceFieldId) {
        dependencies.add(aiConfig.sourceFieldId);
      }

      if ('prompt' in aiConfig) {
        const { prompt, attachmentFieldIds = [] } = aiConfig;
        extractFieldReferences(prompt).forEach((fieldId) => dependencies.add(fieldId));
        attachmentFieldIds.forEach((fieldId) => dependencies.add(fieldId));
      }
    }

    if (field.type === FieldType.Formula && !field.isLookup) {
      const formulaOptions = field.options as IFormulaFieldOptions;
      extractFieldReferences(formulaOptions.expression).forEach((fieldId) =>
        dependencies.add(fieldId)
      );
    }

    if (field.type === FieldType.ConditionalRollup) {
      const options = field.options as IConditionalRollupFieldOptions | undefined;
      if (options) {
        this.collectConditionalDependencies({
          lookupFieldId: options.lookupFieldId,
          filter: options.filter,
          sortFieldId: options.sort?.fieldId,
        }).forEach((fieldId) => dependencies.add(fieldId));
      }
    }

    if (field.isLookup && field.isConditionalLookup) {
      const lookupOptions = field.lookupOptions as IConditionalLookupOptions | undefined;
      if (lookupOptions) {
        this.collectConditionalDependencies({
          lookupFieldId: lookupOptions.lookupFieldId,
          filter: lookupOptions.filter,
          sortFieldId: lookupOptions.sort?.fieldId,
        }).forEach((fieldId) => dependencies.add(fieldId));
      }
    }

    if (field.isLookup || field.type === FieldType.Rollup) {
      const lookupOptions = field.lookupOptions;
      if (lookupOptions && isLinkLookupOptions(lookupOptions)) {
        dependencies.add(lookupOptions.linkFieldId);
        dependencies.add(lookupOptions.lookupFieldId);
      }
    }

    for (const depId of [...dependencies]) {
      if (depId === field.id || !duplicatingFieldIds.has(depId)) {
        dependencies.delete(depId);
      }
    }

    return dependencies;
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
      const { attachmentFieldIds = [] } = aiConfig;
      Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
        aiConfig.prompt = aiConfig.prompt.replaceAll(key, value);
      });
      aiConfig.attachmentFieldIds = attachmentFieldIds?.map(
        (fieldId) => sourceToTargetFieldMap[fieldId]
      );
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
    }: { notNull?: boolean; unique?: boolean; dbFieldName: string; isPrimary?: boolean }
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
      const fieldValidationSqls = this.knex.schema
        .alterTable(dbTableName, (table) => {
          if (unique)
            table.unique([dbFieldName], {
              indexName: this.fieldOpenApiService.getFieldUniqueKeyName(
                dbTableName,
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
}
