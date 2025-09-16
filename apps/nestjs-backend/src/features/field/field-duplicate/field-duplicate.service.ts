import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type {
  IFieldVo,
  IFormulaFieldOptions,
  ILinkFieldOptions,
  ILookupOptionsRo,
} from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson, IFieldJson, IFieldWithTableIdJson } from '@teable/openapi';
import { Knex } from 'knex';
import { pick, get } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { extractFieldReferences } from '../../../utils';
import { DEFAULT_EXPRESSION } from '../../base/constant';
import { replaceStringByMap } from '../../base/utils';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByRaw } from '../model/factory';
import { FieldOpenApiService } from '../open-api/field-open-api.service';
import { dbType2knexFormat } from '../util';

@Injectable()
export class FieldDuplicateService {
  private readonly logger = new Logger(FieldDuplicateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
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
    });
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
      const {
        id,
        options,
        dbFieldType,
        targetTableId,
        dbFieldName,
        cellValueType,
        isMultipleCellValue,
      } = field;
      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });
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
        const schemaType = dbType2knexFormat(this.knex, dbFieldType);
        const modifyColumnSql = this.dbProvider.modifyColumnSchema(
          dbTableName,
          dbFieldName,
          schemaType
        );

        for (const alterTableQuery of modifyColumnSql) {
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
          fieldMap
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
            true
          );
        } else if (!countMap[curField.id] || countMap[curField.id] < maxCount) {
          dependFields.push(curField);
          checkedField.push(curField);
          countMap[curField.id] = (countMap[curField.id] || 0) + 1;
        } else {
          throw new BadGatewayException(
            `Create circular field when create field: ${curField?.name || curField?.id || 'unknown field'}`
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
    hasError = false
  ) {
    const isAiConfig = field.aiConfig && !field.isLookup;
    const isLookup = field.isLookup;
    const isRollup = field.type === FieldType.Rollup && !field.isLookup;
    const isFormula = field.type === FieldType.Formula && !field.isLookup;

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
      case isFormula:
        await this.duplicateFormulaField(targetTableId, field, sourceToTargetFieldMap, hasError);
    }
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
    } = field;
    const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptions as ILookupOptionsRo;
    const isSelfLink = foreignTableId === sourceTableId;

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
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, field.order, {
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
    const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptions as ILookupOptionsRo;
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
        },
      });
    }

    if (dbFieldType !== newField.dbFieldType) {
      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });
      const schemaType = dbType2knexFormat(this.knex, dbFieldType);
      const modifyColumnSql = this.dbProvider.modifyColumnSchema(
        dbTableName,
        dbFieldName,
        schemaType
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

  private async isInDegreeReady(
    field: IFieldWithTableIdJson,
    fieldMap: Record<string, string>,
    scope: 'base' | 'table' = 'base'
  ) {
    const { isLookup, type } = field;
    if (field.aiConfig) {
      const { aiConfig } = field;

      if ('sourceFieldId' in aiConfig) {
        return Boolean(fieldMap[aiConfig.sourceFieldId]);
      }

      if ('prompt' in aiConfig) {
        const { prompt, attachmentFieldIds = [] } = aiConfig;
        const fieldIds = extractFieldReferences(prompt);
        const keys = Object.keys(fieldMap);
        return [...fieldIds, ...attachmentFieldIds].every((field) => keys.includes(field));
      }
    }

    if (type === FieldType.Formula && !isLookup) {
      const formulaOptions = field.options as IFormulaFieldOptions;
      const referencedFields = this.extractFieldIds(formulaOptions.expression);
      const keys = Object.keys(fieldMap);
      return referencedFields.every((field) => keys.includes(field));
    }

    if (isLookup || type === FieldType.Rollup) {
      const { lookupOptions, sourceTableId } = field;
      const { linkFieldId, lookupFieldId, foreignTableId } = lookupOptions as ILookupOptionsRo;
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
}
