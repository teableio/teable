/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AttachmentFieldCore,
  AutoNumberFieldCore,
  ButtonFieldCore,
  CellValueType,
  CheckboxFieldCore,
  ColorUtils,
  ConditionalRollupFieldCore,
  CreatedTimeFieldCore,
  DateFieldCore,
  DbFieldType,
  extractFieldIdsFromFilter,
  FieldAIActionType,
  FieldType,
  generateChoiceId,
  generateFieldId,
  getAiConfigSchema,
  getDbFieldType,
  getDefaultFormatting,
  getFormattingSchema,
  getRandomString,
  getShowAsSchema,
  getUniqName,
  isMultiValueLink,
  isConditionalLookupOptions,
  isLinkLookupOptions,
  LastModifiedTimeFieldCore,
  LongTextFieldCore,
  NumberFieldCore,
  RatingFieldCore,
  Relationship,
  RelationshipRevert,
  SelectFieldCore,
  SingleLineTextFieldCore,
  UserFieldCore,
  HttpErrorCode,
} from '@teable/core';
import type {
  IFieldRo,
  IFieldVo,
  IFormulaFieldOptions,
  ILinkFieldOptions,
  ILinkFieldOptionsRo,
  ILinkFieldMeta,
  ILookupOptionsRo,
  ILookupOptionsVo,
  IConditionalRollupFieldOptions,
  IRollupFieldOptions,
  ISelectFieldOptionsRo,
  IConvertFieldRo,
  IUserFieldOptions,
  ITextFieldCustomizeAIConfig,
  ITextFieldSummarizeAIConfig,
  IConditionalLookupOptions,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { uniq, keyBy, mergeWith } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import type { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { CustomHttpException } from '../../../custom.exception';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { extractFieldReferences } from '../../../utils';
import {
  majorFieldKeysChanged,
  NON_INFECT_OPTION_KEYS,
} from '../../../utils/major-field-keys-changed';
import { ReferenceService } from '../../calculation/reference.service';
import { hasCycle } from '../../calculation/utils/dfs';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByVo } from '../model/factory';
import { ConditionalRollupFieldDto } from '../model/field-dto/conditional-rollup-field.dto';
import { FormulaFieldDto } from '../model/field-dto/formula-field.dto';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
import { RollupFieldDto } from '../model/field-dto/rollup-field.dto';

@Injectable()
export class FieldSupplementService {
  constructor(
    private readonly fieldService: FieldService,
    private readonly prismaService: PrismaService,
    private readonly referenceService: ReferenceService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async getDbTableName(tableId: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  private getForeignKeyFieldName(fieldId: string | undefined) {
    if (!fieldId) {
      return `__fk_rad${getRandomString(16)}`;
    }
    return `__fk_${fieldId}`;
  }

  private async getJunctionTableName(
    tableId: string,
    fieldId: string,
    symmetricFieldId: string | undefined
  ) {
    const { baseId } = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { baseId: true },
    });

    const junctionTableName = symmetricFieldId
      ? `junction_${fieldId}_${symmetricFieldId}`
      : `junction_${fieldId}`;
    return this.dbProvider.generateDbTableName(baseId, junctionTableName);
  }

  private async getDefaultLinkName(foreignTableId: string) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findUnique({
      where: { id: foreignTableId },
      select: { name: true },
    });
    if (!tableRaw) {
      throw new CustomHttpException(
        `foreignTableId ${foreignTableId} is invalid`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.foreignTableIdInvalid',
            context: { foreignTableId },
          },
        }
      );
    }
    return tableRaw.name;
  }

  private async generateLinkOptionsVo(params: {
    tableId: string;
    optionsRo: ILinkFieldOptionsRo;
    fieldId: string;
    symmetricFieldId: string | undefined;
    lookupFieldId: string;
    dbTableName: string;
    foreignTableName: string;
  }): Promise<ILinkFieldOptions> {
    const {
      tableId,
      optionsRo,
      fieldId,
      symmetricFieldId,
      lookupFieldId,
      dbTableName,
      foreignTableName,
    } = params;
    const { relationship, isOneWay = false } = optionsRo;
    const common = {
      ...optionsRo,
      isOneWay: isOneWay || false,
      symmetricFieldId,
      lookupFieldId,
    };

    if (relationship === Relationship.ManyMany) {
      const fkHostTableName = await this.getJunctionTableName(tableId, fieldId, symmetricFieldId);
      return {
        ...common,
        fkHostTableName,
        selfKeyName: this.getForeignKeyFieldName(symmetricFieldId),
        foreignKeyName: this.getForeignKeyFieldName(fieldId),
      };
    }

    if (relationship === Relationship.ManyOne) {
      return {
        ...common,
        fkHostTableName: dbTableName,
        selfKeyName: '__id',
        foreignKeyName: this.getForeignKeyFieldName(fieldId),
      };
    }

    if (relationship === Relationship.OneMany) {
      return {
        ...common,
        /**
         * Semantically, one way link should not cause any side effects on the foreign table,
         * so we should not modify the foreign table when `isOneWay` enable.
         * Instead, we will create a junction table to store the foreign key.
         */
        fkHostTableName: isOneWay
          ? await this.getJunctionTableName(tableId, fieldId, symmetricFieldId)
          : foreignTableName,
        selfKeyName: this.getForeignKeyFieldName(symmetricFieldId),
        foreignKeyName: isOneWay ? this.getForeignKeyFieldName(fieldId) : '__id',
      };
    }

    if (relationship === Relationship.OneOne) {
      return {
        ...common,
        fkHostTableName: dbTableName,
        selfKeyName: '__id',
        foreignKeyName: this.getForeignKeyFieldName(fieldId),
      };
    }

    throw new CustomHttpException('relationship is invalid', HttpErrorCode.VALIDATION_ERROR, {
      localization: {
        i18nKey: 'httpErrors.field.relationshipInvalid',
        context: { relationship },
      },
    });
  }

  async generateNewLinkOptionsVo(
    tableId: string,
    fieldId: string,
    optionsRo: ILinkFieldOptionsRo
  ): Promise<ILinkFieldOptions> {
    const { baseId, foreignTableId, isOneWay } = optionsRo;
    let lookupFieldId = optionsRo.lookupFieldId;
    const symmetricFieldId = isOneWay ? undefined : generateFieldId();
    const dbTableName = await this.getDbTableName(tableId);
    const foreignTableName = await this.getDbTableName(foreignTableId);

    if (!lookupFieldId) {
      const labelField = await this.prismaService.txClient().field.findFirst({
        where: {
          tableId: foreignTableId,
          name: 'Label',
          deletedTime: null,
        },
        select: { id: true },
      });

      if (labelField?.id) {
        lookupFieldId = labelField.id;
      } else {
        const { id: defaultLookupFieldId } = await this.prismaService
          .txClient()
          .field.findFirstOrThrow({
            where: { tableId: foreignTableId, isPrimary: true },
            select: { id: true },
          });
        lookupFieldId = defaultLookupFieldId;
      }
    }

    if (baseId) {
      await this.prismaService.tableMeta
        .findFirstOrThrow({
          where: { id: foreignTableId, baseId, deletedTime: null },
          select: { id: true },
        })
        .catch(() => {
          throw new CustomHttpException(
            `foreignTableId ${foreignTableId} is invalid`,
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.field.foreignTableIdInvalid',
                context: { foreignTableId },
              },
            }
          );
        });
    }

    return this.generateLinkOptionsVo({
      tableId,
      optionsRo,
      fieldId,
      symmetricFieldId,
      lookupFieldId,
      dbTableName,
      foreignTableName,
    });
  }

  async generateUpdatedLinkOptionsVo(
    tableId: string,
    fieldId: string,
    oldOptions: ILinkFieldOptions,
    newOptionsRo: ILinkFieldOptionsRo
  ): Promise<ILinkFieldOptions> {
    const { baseId, foreignTableId, isOneWay } = newOptionsRo;

    const dbTableName = await this.getDbTableName(tableId);
    const foreignTableName = await this.getDbTableName(foreignTableId);

    const symmetricFieldId = (() => {
      if (isOneWay) {
        return undefined;
      }

      if (oldOptions.isOneWay) {
        return generateFieldId();
      }

      if (oldOptions.foreignTableId === newOptionsRo.foreignTableId) {
        return oldOptions.symmetricFieldId;
      }

      return generateFieldId();
    })();

    let lookupFieldId = newOptionsRo.lookupFieldId;
    if (!lookupFieldId) {
      const sameTable = oldOptions.foreignTableId === foreignTableId;
      if (sameTable) {
        lookupFieldId = oldOptions.lookupFieldId;
      }
    }
    if (!lookupFieldId) {
      const labelField = await this.prismaService.txClient().field.findFirst({
        where: { tableId: foreignTableId, name: 'Label', deletedTime: null },
        select: { id: true },
      });
      if (labelField?.id) {
        lookupFieldId = labelField.id;
      } else {
        const { id: defaultLookupFieldId } = await this.prismaService
          .txClient()
          .field.findFirstOrThrow({
            where: { tableId: foreignTableId, isPrimary: true, deletedTime: null },
            select: { id: true },
          });
        lookupFieldId = defaultLookupFieldId;
      }
    }

    if (baseId) {
      await this.prismaService.tableMeta
        .findFirstOrThrow({
          where: { id: foreignTableId, baseId, deletedTime: null },
          select: { id: true },
        })
        .catch(() => {
          throw new CustomHttpException(
            `foreignTableId ${foreignTableId} is invalid`,
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.field.foreignTableIdInvalid',
                context: { foreignTableId },
              },
            }
          );
        });
    }

    const isSameSymmetricFieldId =
      (!symmetricFieldId && !oldOptions.symmetricFieldId) ||
      symmetricFieldId === oldOptions.symmetricFieldId;

    if (
      newOptionsRo.foreignTableId === oldOptions.foreignTableId &&
      newOptionsRo.relationship === oldOptions.relationship &&
      isSameSymmetricFieldId
    ) {
      return {
        ...newOptionsRo,
        isOneWay: isOneWay || false,
        symmetricFieldId,
        lookupFieldId,
        fkHostTableName: oldOptions.fkHostTableName,
        selfKeyName: oldOptions.selfKeyName,
        foreignKeyName: oldOptions.foreignKeyName,
      };
    }

    return this.generateLinkOptionsVo({
      tableId,
      optionsRo: newOptionsRo,
      fieldId,
      symmetricFieldId,
      lookupFieldId,
      dbTableName,
      foreignTableName,
    });
  }

  private async prepareLinkField(tableId: string, field: IFieldRo) {
    let options = field.options as ILinkFieldOptionsRo;
    const { baseId, relationship, foreignTableId } = options;

    // if link target is in the same base, we should not set baseId
    if (baseId) {
      const tableMeta = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
        where: { id: tableId, deletedTime: null },
        select: { id: true, baseId: true },
      });
      if (tableMeta.baseId === baseId) {
        options = {
          ...options,
          baseId: undefined,
        };
      }
    }

    const fieldId = field.id ?? generateFieldId();
    const optionsVo = await this.generateNewLinkOptionsVo(tableId, fieldId, options);

    return {
      ...field,
      id: fieldId,
      name: field.name ?? (await this.getDefaultLinkName(foreignTableId)),
      options: optionsVo,
      isMultipleCellValue: isMultiValueLink(relationship) || undefined,
      dbFieldType: DbFieldType.Json,
      cellValueType: CellValueType.String,
      meta: this.buildLinkFieldMeta(optionsVo),
    };
  }

  // only for linkField to linkField
  private async prepareUpdateLinkField(tableId: string, fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    if (!majorFieldKeysChanged(oldFieldVo, fieldRo)) {
      return mergeWith({}, oldFieldVo, fieldRo, (_oldValue: unknown, newValue: unknown) => {
        if (Array.isArray(newValue)) {
          return newValue;
        }
      });
    }

    const newOptionsRo = fieldRo.options as ILinkFieldOptionsRo;
    const oldOptions = oldFieldVo.options as ILinkFieldOptions;
    // isOneWay may be undefined or false, so we should convert it to boolean
    const oldIsOneWay = Boolean(oldOptions.isOneWay);
    const newIsOneWay = Boolean(newOptionsRo.isOneWay);
    if (
      oldOptions.foreignTableId === newOptionsRo.foreignTableId &&
      oldOptions.relationship === newOptionsRo.relationship &&
      oldIsOneWay !== newIsOneWay
    ) {
      // Recompute full link options when toggling one-way <-> two-way to ensure
      // fkHostTableName/selfKeyName/foreignKeyName are correct for the new mode.
      const optionsVo = await this.generateUpdatedLinkOptionsVo(
        tableId,
        oldFieldVo.id,
        oldOptions,
        newOptionsRo
      );

      return {
        ...oldFieldVo,
        ...fieldRo,
        options: optionsVo,
        isMultipleCellValue: isMultiValueLink(optionsVo.relationship) || undefined,
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        meta: this.buildLinkFieldMeta(optionsVo),
      };
    }

    const fieldId = oldFieldVo.id;

    const optionsVo = await this.generateUpdatedLinkOptionsVo(
      tableId,
      fieldId,
      oldOptions,
      newOptionsRo
    );

    return {
      ...oldFieldVo,
      ...fieldRo,
      options: optionsVo,
      isMultipleCellValue: isMultiValueLink(optionsVo.relationship) || undefined,
      dbFieldType: DbFieldType.Json,
      cellValueType: CellValueType.String,
      meta: this.buildLinkFieldMeta(optionsVo),
    };
  }

  private buildLinkFieldMeta(options: ILinkFieldOptions): ILinkFieldMeta {
    const { relationship, isOneWay } = options;
    const hasOrderColumn =
      relationship === Relationship.ManyMany ||
      relationship === Relationship.ManyOne ||
      relationship === Relationship.OneOne ||
      (relationship === Relationship.OneMany && !isOneWay);

    return { hasOrderColumn: Boolean(hasOrderColumn) };
  }

  private async prepareLookupOptions(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions } = field;
    if (!lookupOptions) {
      throw new CustomHttpException(`lookupOptions is required`, HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'editor.lookup.lookupOptionsRequired',
        },
      });
    }

    if (!isLinkLookupOptions(lookupOptions)) {
      throw new BadRequestException('lookupOptions.linkFieldId is required for lookup fields');
    }

    const { linkFieldId, lookupFieldId, foreignTableId } = lookupOptions;
    const linkFieldRaw = await this.prismaService.txClient().field.findFirst({
      where: { id: linkFieldId, deletedTime: null, type: FieldType.Link },
      select: { name: true, options: true, isMultipleCellValue: true },
    });

    const optionsRaw = linkFieldRaw?.options || null;
    const linkFieldOptions: ILinkFieldOptions =
      (optionsRaw && JSON.parse(optionsRaw as string)) ||
      batchFieldVos?.find((field) => field.id === linkFieldId)?.options;

    if (!linkFieldOptions || !linkFieldRaw) {
      throw new CustomHttpException(
        `linkFieldId ${linkFieldId} is invalid`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.linkFieldIdInvalid',
            context: { linkFieldId },
          },
        }
      );
    }

    if (foreignTableId !== linkFieldOptions.foreignTableId) {
      throw new CustomHttpException(
        `foreignTableId ${foreignTableId} is invalid`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.foreignTableIdInvalid',
            context: { foreignTableId },
          },
        }
      );
    }

    const lookupFieldRaw = await this.prismaService.txClient().field.findFirst({
      where: { id: lookupFieldId, deletedTime: null },
    });

    if (!lookupFieldRaw) {
      throw new CustomHttpException(
        `Lookup field ${lookupFieldId} is invalid`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.lookupFieldIdInvalid',
            context: { lookupFieldId },
          },
        }
      );
    }

    return {
      lookupOptions: {
        ...lookupOptions,
        relationship: linkFieldOptions.relationship,
        fkHostTableName: linkFieldOptions.fkHostTableName,
        selfKeyName: linkFieldOptions.selfKeyName,
        foreignKeyName: linkFieldOptions.foreignKeyName,
      },
      lookupFieldRaw,
      linkFieldRaw,
    };
  }

  getDbFieldType(
    fieldType: FieldType,
    cellValueType: CellValueType,
    isMultipleCellValue?: boolean
  ) {
    return getDbFieldType(fieldType, cellValueType, isMultipleCellValue);
  }

  prepareFormattingShowAs(
    options: IFieldRo['options'] = {},
    sourceOptions: IFieldVo['options'],
    cellValueType: CellValueType,
    isMultipleCellValue?: boolean
  ) {
    const sourceFormatting = 'formatting' in sourceOptions ? sourceOptions.formatting : undefined;
    const showAsSchema = getShowAsSchema(cellValueType, isMultipleCellValue);
    let sourceShowAs = 'showAs' in sourceOptions ? sourceOptions.showAs : undefined;

    // if source showAs is invalid, we should ignore it
    if (sourceShowAs && !showAsSchema.safeParse(sourceShowAs).success) {
      sourceShowAs = undefined;
    }

    const formatting =
      'formatting' in options
        ? options.formatting
        : sourceFormatting
          ? sourceFormatting
          : getDefaultFormatting(cellValueType);

    const showAs = 'showAs' in options ? options.showAs : sourceShowAs;

    return {
      ...sourceOptions,
      formatting,
      showAs,
    };
  }

  private async prepareLookupField(fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    if (fieldRo.isConditionalLookup) {
      return this.prepareConditionalLookupField(fieldRo);
    }

    const { lookupOptions, lookupFieldRaw, linkFieldRaw } = await this.prepareLookupOptions(
      fieldRo,
      batchFieldVos
    );

    if (lookupFieldRaw.type !== fieldRo.type) {
      throw new CustomHttpException(
        `Current field type ${fieldRo.type} is not equal to lookup field (${lookupFieldRaw.type})`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.lookupFieldTypeNotEqual',
            context: { fieldType: fieldRo.type, lookupFieldType: lookupFieldRaw.type },
          },
        }
      );
    }

    const isMultipleCellValue =
      linkFieldRaw.isMultipleCellValue || lookupFieldRaw.isMultipleCellValue || false;

    const cellValueType = lookupFieldRaw.cellValueType as CellValueType;

    const options = this.prepareFormattingShowAs(
      fieldRo.options,
      JSON.parse(lookupFieldRaw.options as string),
      cellValueType,
      isMultipleCellValue
    );

    return {
      ...fieldRo,
      name: fieldRo.name ?? `${lookupFieldRaw.name} (from ${linkFieldRaw.name})`,
      options,
      lookupOptions,
      isMultipleCellValue,
      isComputed: true,
      cellValueType,
      dbFieldType: this.getDbFieldType(fieldRo.type, cellValueType, isMultipleCellValue),
    };
  }

  private async prepareUpdateLookupField(fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    if (fieldRo.isConditionalLookup) {
      return this.prepareConditionalLookupField(fieldRo);
    }

    const newLookupOptions = fieldRo.lookupOptions as ILookupOptionsRo | undefined;
    const oldLookupOptions = oldFieldVo.lookupOptions as ILookupOptionsVo | undefined;

    if (!newLookupOptions || !isLinkLookupOptions(newLookupOptions)) {
      return this.prepareLookupField(fieldRo);
    }

    if (!oldLookupOptions || !isLinkLookupOptions(oldLookupOptions)) {
      return this.prepareLookupField(fieldRo);
    }
    if (
      oldFieldVo.isLookup &&
      newLookupOptions.lookupFieldId === oldLookupOptions.lookupFieldId &&
      newLookupOptions.linkFieldId === oldLookupOptions.linkFieldId &&
      newLookupOptions.foreignTableId === oldLookupOptions.foreignTableId
    ) {
      return {
        ...oldFieldVo,
        ...fieldRo,
        options: {
          ...oldFieldVo.options,
          showAs: undefined,
        },
        lookupOptions: {
          ...oldLookupOptions,
          ...newLookupOptions,
        },
      };
    }

    return this.prepareLookupField(fieldRo);
  }

  private async prepareFormulaField(fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    let fieldIds;
    try {
      fieldIds = FormulaFieldDto.getReferenceFieldIds(
        (fieldRo.options as IFormulaFieldOptions).expression
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new CustomHttpException(
        `formula expression ${(fieldRo.options as IFormulaFieldOptions).expression} parse error: ${e.message}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.formulaExpressionParseError',
          },
        }
      );
    }

    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
    });

    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const batchFields = batchFieldVos?.map((fieldVo) => createFieldInstanceByVo(fieldVo));
    const fieldMap = keyBy(fields.concat(batchFields || []), 'id');

    if (fieldIds.find((id) => !fieldMap[id])) {
      throw new CustomHttpException(
        `formula field reference ${fieldIds.join()} not found`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.formulaReferenceNotFound',
            context: {
              fieldIds: fieldIds.join(),
            },
          },
        }
      );
    }

    const { cellValueType, isMultipleCellValue } = FormulaFieldDto.getParsedValueType(
      (fieldRo.options as IFormulaFieldOptions).expression,
      fieldMap
    );

    const formatting =
      (fieldRo.options as IFormulaFieldOptions)?.formatting ?? getDefaultFormatting(cellValueType);

    return {
      ...fieldRo,
      name: fieldRo.name ?? 'Calculation',
      options: {
        ...fieldRo.options,
        ...(formatting ? { formatting } : {}),
      },
      cellValueType,
      isMultipleCellValue,
      isComputed: true,
      dbFieldType: this.getDbFieldType(
        fieldRo.type,
        cellValueType as CellValueType,
        isMultipleCellValue
      ),
    };
  }

  private async prepareUpdateFormulaField(fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    if (!majorFieldKeysChanged(oldFieldVo, fieldRo)) {
      return { ...oldFieldVo, ...fieldRo };
    }

    return this.prepareFormulaField(fieldRo);
  }

  private async prepareRollupField(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions, linkFieldRaw, lookupFieldRaw } = await this.prepareLookupOptions(
      field,
      batchFieldVos
    );
    const options = field.options as IRollupFieldOptions;
    const lookupField = createFieldInstanceByRaw(lookupFieldRaw);
    if (!options) {
      throw new CustomHttpException(
        'rollup field options is required',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'editor.error.optionsRequired',
          },
        }
      );
    }

    let valueType;
    try {
      valueType = RollupFieldDto.getParsedValueType(
        options.expression,
        lookupField.cellValueType,
        lookupField.isMultipleCellValue || linkFieldRaw.isMultipleCellValue || false
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new CustomHttpException(
        `Parse rollup expression ${options.expression} error: ${e.message}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'editor.error.rollupExpressionParseError',
          },
        }
      );
    }

    const { cellValueType, isMultipleCellValue } = valueType;

    const formatting = options.formatting ?? getDefaultFormatting(cellValueType);

    return {
      ...field,
      name: field.name ?? `${lookupFieldRaw.name} Rollup (from ${linkFieldRaw.name})`,
      options: {
        ...options,
        ...(formatting ? { formatting } : {}),
      },
      lookupOptions,
      cellValueType,
      isComputed: true,
      isMultipleCellValue,
      dbFieldType: this.getDbFieldType(
        field.type,
        cellValueType as CellValueType,
        isMultipleCellValue
      ),
    };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async prepareConditionalRollupField(field: IFieldRo) {
    const rawOptions = field.options as IConditionalRollupFieldOptions | undefined;
    const options = { ...(rawOptions || {}) } as IConditionalRollupFieldOptions | undefined;
    if (!options) {
      throw new BadRequestException('Conditional rollup field options are required');
    }

    if (!options.sort || options.sort.fieldId == null) {
      delete options.sort;
    }
    if (options.limit == null) {
      delete options.limit;
    }

    const { foreignTableId, lookupFieldId } = options;

    if (!foreignTableId) {
      throw new BadRequestException('Conditional rollup field foreignTableId is required');
    }

    if (!lookupFieldId) {
      throw new BadRequestException('Conditional rollup field lookupFieldId is required');
    }

    const lookupFieldRaw = await this.prismaService.txClient().field.findFirst({
      where: { id: lookupFieldId, deletedTime: null },
    });

    if (!lookupFieldRaw) {
      throw new BadRequestException(`Conditional rollup field ${lookupFieldId} is not exist`);
    }

    if (lookupFieldRaw.tableId !== foreignTableId) {
      throw new BadRequestException(
        `Conditional rollup field ${lookupFieldId} does not belong to table ${foreignTableId}`
      );
    }

    const lookupField = createFieldInstanceByRaw(lookupFieldRaw);

    const expression =
      options.expression ??
      ConditionalRollupFieldDto.defaultOptions(lookupField.cellValueType).expression!;

    if (!ConditionalRollupFieldCore.supportsOrdering(expression)) {
      delete options.sort;
      delete options.limit;
    }

    let valueType;
    try {
      valueType = ConditionalRollupFieldDto.getParsedValueType(
        expression,
        lookupField.cellValueType,
        lookupField.isMultipleCellValue ?? false
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new BadRequestException(`Conditional rollup parse error: ${e.message}`);
    }

    const { cellValueType, isMultipleCellValue } = valueType;

    const formatting = options.formatting ?? getDefaultFormatting(cellValueType);
    const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    const foreignTable = await this.prismaService.txClient().tableMeta.findUnique({
      where: { id: foreignTableId },
      select: { name: true },
    });

    const defaultName = foreignTable?.name
      ? `${lookupFieldRaw.name} Reference (${foreignTable.name})`
      : `${lookupFieldRaw.name} Reference`;

    return {
      ...field,
      name: field.name ?? defaultName,
      options: {
        ...options,
        ...(formatting ? { formatting } : {}),
        expression,
        timeZone,
        foreignTableId,
        lookupFieldId,
      },
      cellValueType,
      isComputed: true,
      isMultipleCellValue,
      dbFieldType: this.getDbFieldType(
        field.type,
        cellValueType as CellValueType,
        isMultipleCellValue
      ),
    };
  }

  private async prepareConditionalLookupField(field: IFieldRo) {
    const lookupOptions = field.lookupOptions as ILookupOptionsRo | undefined;
    const conditionalLookup = isConditionalLookupOptions(lookupOptions)
      ? (lookupOptions as IConditionalLookupOptions)
      : undefined;
    if (!conditionalLookup) {
      throw new BadRequestException('Conditional lookup configuration is required');
    }

    const { foreignTableId, lookupFieldId } = conditionalLookup;

    if (!foreignTableId) {
      throw new BadRequestException('Conditional lookup foreignTableId is required');
    }

    if (!lookupFieldId) {
      throw new BadRequestException('Conditional lookup lookupFieldId is required');
    }

    const lookupFieldRaw = await this.prismaService.txClient().field.findFirst({
      where: { id: lookupFieldId, deletedTime: null },
    });

    if (!lookupFieldRaw) {
      throw new BadRequestException(`Conditional lookup field ${lookupFieldId} is not exist`);
    }

    if (lookupFieldRaw.tableId !== foreignTableId) {
      throw new BadRequestException(
        `Conditional lookup field ${lookupFieldId} does not belong to table ${foreignTableId}`
      );
    }

    if (lookupFieldRaw.type !== field.type) {
      throw new BadRequestException(
        `Current field type ${field.type} is not equal to lookup field (${lookupFieldRaw.type})`
      );
    }

    const lookupField = createFieldInstanceByRaw(lookupFieldRaw);
    const cellValueType = lookupField.cellValueType as CellValueType;

    const formatting = this.prepareFormattingShowAs(
      field.options,
      JSON.parse(lookupFieldRaw.options as string),
      cellValueType,
      true
    );

    const foreignTable = await this.prismaService.txClient().tableMeta.findUnique({
      where: { id: foreignTableId },
      select: { name: true },
    });

    const defaultName = foreignTable?.name
      ? `${lookupFieldRaw.name} (${foreignTable.name})`
      : `${lookupFieldRaw.name} Conditional Lookup`;

    return {
      ...field,
      name: field.name ?? defaultName,
      options: formatting,
      lookupOptions: {
        baseId: conditionalLookup.baseId,
        foreignTableId,
        lookupFieldId,
        filter: conditionalLookup.filter,
        sort: conditionalLookup.sort,
        limit: conditionalLookup.limit,
      },
      isMultipleCellValue: true,
      isComputed: true,
      cellValueType,
      dbFieldType: this.getDbFieldType(field.type, cellValueType, true),
    };
  }

  private async prepareUpdateRollupField(fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    const newOptions = fieldRo.options as IRollupFieldOptions;
    const oldOptions = oldFieldVo.options as IRollupFieldOptions;

    if (!majorFieldKeysChanged(oldFieldVo, fieldRo)) {
      return { ...oldFieldVo, ...fieldRo };
    }

    const newLookupOptions = fieldRo.lookupOptions as ILookupOptionsRo | undefined;
    const oldLookupOptions = oldFieldVo.lookupOptions as ILookupOptionsVo | undefined;

    if (
      !newLookupOptions ||
      !oldLookupOptions ||
      !isLinkLookupOptions(newLookupOptions) ||
      !isLinkLookupOptions(oldLookupOptions)
    ) {
      return this.prepareRollupField(fieldRo);
    }
    if (
      newOptions.expression === oldOptions.expression &&
      newLookupOptions.lookupFieldId === oldLookupOptions.lookupFieldId &&
      newLookupOptions.linkFieldId === oldLookupOptions.linkFieldId &&
      newLookupOptions.foreignTableId === oldLookupOptions.foreignTableId
    ) {
      return {
        ...oldFieldVo,
        ...fieldRo,
        options: {
          ...oldOptions,
          showAs: newOptions.showAs,
          formatting: newOptions.formatting,
        },
        lookupOptions: { ...oldLookupOptions, ...newLookupOptions },
      };
    }

    return this.prepareRollupField(fieldRo);
  }

  private prepareSingleTextField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Label',
      options: options ?? SingleLineTextFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
  }

  private prepareLongTextField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Notes',
      options: options ?? LongTextFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
  }

  private prepareNumberField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Number',
      options: options ?? NumberFieldCore.defaultOptions(),
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    };
  }

  private prepareRatingField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Rating',
      options: options ?? RatingFieldCore.defaultOptions(),
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    };
  }

  private prepareSelectOptions(options: ISelectFieldOptionsRo, isMultiple: boolean) {
    const optionsRo = (options ?? SelectFieldCore.defaultOptions()) as ISelectFieldOptionsRo;
    const nameSet = new Set<string>();
    const choices = optionsRo.choices.map((choice) => {
      if (nameSet.has(choice.name)) {
        throw new CustomHttpException(
          `choice name ${choice.name} is already exists`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.field.choiceNameAlreadyExists',
              context: { name: choice.name },
            },
          }
        );
      }
      nameSet.add(choice.name);
      return {
        name: choice.name,
        id: choice.id ?? generateChoiceId(),
        color: choice.color ?? ColorUtils.randomColor()[0],
      };
    });

    const defaultValue = optionsRo.defaultValue
      ? [optionsRo.defaultValue].flat().filter((name) => nameSet.has(name))
      : undefined;

    return {
      ...optionsRo,
      defaultValue: isMultiple ? defaultValue : defaultValue?.[0],
      choices,
    };
  }

  private prepareSingleSelectField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Select',
      options: this.prepareSelectOptions(options as ISelectFieldOptionsRo, false),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
  }

  private prepareMultipleSelectField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Tags',
      options: this.prepareSelectOptions(options as ISelectFieldOptionsRo, true),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: true,
    };
  }

  private prepareAttachmentField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Attachments',
      options: options ?? AttachmentFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: true,
    };
  }

  private async prepareUpdateUserField(fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    const mergeObj = {
      ...oldFieldVo,
      ...fieldRo,
    };

    return this.prepareUserField(mergeObj);
  }

  private prepareUserField(field: IFieldRo) {
    const { name } = field;
    const options: IUserFieldOptions = field.options || UserFieldCore.defaultOptions();
    const { isMultiple } = options;
    const defaultValue = options.defaultValue ? [options.defaultValue].flat() : undefined;

    return {
      ...field,
      name: name ?? `Collaborator${isMultiple ? 's' : ''}`,
      options: {
        ...options,
        defaultValue: isMultiple ? defaultValue : defaultValue?.[0],
      },
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: isMultiple || undefined,
    };
  }

  private prepareCreatedByField(field: IFieldRo) {
    const { name, options = {} } = field;

    return {
      ...field,
      isComputed: true,
      name: name ?? `Created by`,
      options: options,
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
    };
  }

  private prepareLastModifiedByField(field: IFieldRo) {
    const { name, options = {} } = field;

    return {
      ...field,
      isComputed: true,
      name: name ?? `Last modified by`,
      options: options,
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
    };
  }

  private prepareDateField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Date',
      options: options ?? DateFieldCore.defaultOptions(),
      cellValueType: CellValueType.DateTime,
      dbFieldType: DbFieldType.DateTime,
    };
  }

  private prepareAutoNumberField(field: IFieldRo) {
    const { name } = field;
    const options = field.options ?? AutoNumberFieldCore.defaultOptions();

    return {
      ...field,
      name: name ?? 'ID',
      options: { ...options, expression: 'AUTO_NUMBER()' },
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Integer,
      isComputed: true,
    };
  }

  private prepareCreatedTimeField(field: IFieldRo) {
    const { name } = field;
    const options = field.options ?? CreatedTimeFieldCore.defaultOptions();

    return {
      ...field,
      name: name ?? 'Created Time',
      options: { ...options, expression: 'CREATED_TIME()' },
      cellValueType: CellValueType.DateTime,
      dbFieldType: DbFieldType.DateTime,
      isComputed: true,
    };
  }

  private prepareLastModifiedTimeField(field: IFieldRo) {
    const { name } = field;
    const options = field.options ?? LastModifiedTimeFieldCore.defaultOptions();

    return {
      ...field,
      name: name ?? 'Last Modified Time',
      options: { ...options, expression: 'LAST_MODIFIED_TIME()' },
      cellValueType: CellValueType.DateTime,
      dbFieldType: DbFieldType.DateTime,
      isComputed: true,
    };
  }

  private prepareCheckboxField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Done',
      options: options ?? CheckboxFieldCore.defaultOptions(),
      cellValueType: CellValueType.Boolean,
      dbFieldType: DbFieldType.Boolean,
    };
  }

  private prepareButtonField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Button',
      options: options ?? ButtonFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
    };
  }

  private async prepareCreateFieldInner(
    tableId: string,
    fieldRo: IFieldRo,
    batchFieldVos?: IFieldVo[]
  ) {
    if (fieldRo.isLookup) {
      return this.prepareLookupField(fieldRo, batchFieldVos);
    }

    switch (fieldRo.type) {
      case FieldType.Link:
        return this.prepareLinkField(tableId, fieldRo);
      case FieldType.Rollup:
        return this.prepareRollupField(fieldRo, batchFieldVos);
      case FieldType.ConditionalRollup:
        return this.prepareConditionalRollupField(fieldRo);
      case FieldType.Formula:
        return this.prepareFormulaField(fieldRo, batchFieldVos);
      case FieldType.SingleLineText:
        return this.prepareSingleTextField(fieldRo);
      case FieldType.LongText:
        return this.prepareLongTextField(fieldRo);
      case FieldType.Number:
        return this.prepareNumberField(fieldRo);
      case FieldType.Rating:
        return this.prepareRatingField(fieldRo);
      case FieldType.SingleSelect:
        return this.prepareSingleSelectField(fieldRo);
      case FieldType.MultipleSelect:
        return this.prepareMultipleSelectField(fieldRo);
      case FieldType.Attachment:
        return this.prepareAttachmentField(fieldRo);
      case FieldType.User:
        return this.prepareUserField(fieldRo);
      case FieldType.Date:
        return this.prepareDateField(fieldRo);
      case FieldType.AutoNumber:
        return this.prepareAutoNumberField(fieldRo);
      case FieldType.CreatedTime:
        return this.prepareCreatedTimeField(fieldRo);
      case FieldType.LastModifiedTime:
        return this.prepareLastModifiedTimeField(fieldRo);
      case FieldType.CreatedBy:
        return this.prepareCreatedByField(fieldRo);
      case FieldType.LastModifiedBy:
        return this.prepareLastModifiedByField(fieldRo);
      case FieldType.Checkbox:
        return this.prepareCheckboxField(fieldRo);
      case FieldType.Button:
        return this.prepareButtonField(fieldRo);
      default:
        throw new CustomHttpException(
          `Unsupported field type ${fieldRo.type}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.field.unsupportedFieldType',
              context: { type: fieldRo.type },
            },
          }
        );
    }
  }

  private async prepareUpdateFieldInner(tableId: string, fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    const hasMajorChange = majorFieldKeysChanged(oldFieldVo, fieldRo);

    if (fieldRo.type !== oldFieldVo.type) {
      return this.prepareCreateFieldInner(tableId, fieldRo);
    }

    if (!hasMajorChange) {
      const mergedField = { ...oldFieldVo } as IFieldVo;
      Object.entries(fieldRo).forEach(([key, value]) => {
        if (value !== undefined && key !== 'options' && key !== 'lookupOptions') {
          (mergedField as Record<string, unknown>)[key] = value;
        }
      });
      if (fieldRo.options !== undefined) {
        const oldOptions = (oldFieldVo.options ?? {}) as Record<string, unknown>;
        const newOptions = fieldRo.options as Record<string, unknown>;
        const mergedOptions = { ...oldOptions };

        Object.entries(newOptions).forEach(([key, value]) => {
          if (value === undefined) {
            delete mergedOptions[key];
          } else {
            mergedOptions[key] = value;
          }
        });

        Object.keys(oldOptions).forEach((key) => {
          if (!(key in newOptions) && NON_INFECT_OPTION_KEYS.has(key)) {
            delete mergedOptions[key];
          }
        });

        mergedField.options = mergedOptions as IFieldVo['options'];
      }
      if (fieldRo.lookupOptions !== undefined) {
        const oldLookupOptions = (oldFieldVo.lookupOptions ?? {}) as Record<string, unknown>;
        const newLookupOptions = fieldRo.lookupOptions as Record<string, unknown>;
        const mergedLookupOptions = { ...oldLookupOptions };

        Object.entries(newLookupOptions).forEach(([key, value]) => {
          if (value === undefined) {
            delete mergedLookupOptions[key];
          } else {
            mergedLookupOptions[key] = value;
          }
        });

        mergedField.lookupOptions = mergedLookupOptions as IFieldVo['lookupOptions'];
      }
      return mergedField;
    }

    if (fieldRo.isLookup && hasMajorChange) {
      return this.prepareUpdateLookupField(fieldRo, oldFieldVo);
    }

    switch (fieldRo.type) {
      case FieldType.Link: {
        return this.prepareUpdateLinkField(tableId, fieldRo, oldFieldVo);
      }
      case FieldType.Rollup:
        return this.prepareUpdateRollupField(fieldRo, oldFieldVo);
      case FieldType.ConditionalRollup:
        return this.prepareConditionalRollupField(fieldRo);
      case FieldType.Formula:
        return this.prepareUpdateFormulaField(fieldRo, oldFieldVo);
      case FieldType.SingleLineText:
        return this.prepareSingleTextField(fieldRo);
      case FieldType.LongText:
        return this.prepareLongTextField(fieldRo);
      case FieldType.Number:
        return this.prepareNumberField(fieldRo);
      case FieldType.Rating:
        return this.prepareRatingField(fieldRo);
      case FieldType.SingleSelect:
        return this.prepareSingleSelectField(fieldRo);
      case FieldType.MultipleSelect:
        return this.prepareMultipleSelectField(fieldRo);
      case FieldType.Attachment:
        return this.prepareAttachmentField(fieldRo);
      case FieldType.User:
        return this.prepareUpdateUserField(fieldRo, oldFieldVo);
      case FieldType.Date:
        return this.prepareDateField(fieldRo);
      case FieldType.AutoNumber:
        return this.prepareAutoNumberField(fieldRo);
      case FieldType.CreatedTime:
        return this.prepareCreatedTimeField(fieldRo);
      case FieldType.LastModifiedTime:
        return this.prepareLastModifiedTimeField(fieldRo);
      case FieldType.Checkbox:
        return this.prepareCheckboxField(fieldRo);
      case FieldType.Button:
        return this.prepareButtonField(fieldRo);
      case FieldType.LastModifiedBy:
        return this.prepareLastModifiedByField(fieldRo);
      case FieldType.CreatedBy:
        return this.prepareCreatedByField(fieldRo);
      default:
        throw new CustomHttpException(
          `Unsupported field type ${fieldRo.type}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.field.unsupportedFieldType',
              context: { type: fieldRo.type },
            },
          }
        );
    }
  }

  private zodParse(name: string, schema: z.Schema, value: unknown) {
    const result = (schema as z.Schema).safeParse(value);

    if (!result.success) {
      throw new CustomHttpException(
        `${name} is invalid: ${fromZodError(result.error)}`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
  }

  private validateFormattingShowAs(field: IFieldVo) {
    const { cellValueType, isMultipleCellValue } = field;
    const showAsSchema = getShowAsSchema(cellValueType, isMultipleCellValue);

    const showAs = 'showAs' in field.options ? field.options.showAs : undefined;
    const formatting = 'formatting' in field.options ? field.options.formatting : undefined;

    if (showAs) {
      this.zodParse('showAs', showAsSchema, showAs);
    }

    if (formatting) {
      const formattingSchema = getFormattingSchema(cellValueType);
      this.zodParse('formatting', formattingSchema, formatting);
    }
  }

  private validateAiConfig(field: IFieldVo) {
    const { type, aiConfig } = field;

    const aiConfigSchema = getAiConfigSchema(type);

    if (aiConfig) {
      this.zodParse('aiConfig', aiConfigSchema, aiConfig);
    }
  }

  /**
   * prepare properties for computed field to make sure it's valid
   * this method do not do any db update
   */
  async prepareCreateField(tableId: string, fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const field = (await this.prepareCreateFieldInner(tableId, fieldRo, batchFieldVos)) as IFieldVo;

    const fieldId = field.id || generateFieldId();
    const fieldName = await this.uniqFieldName(tableId, field.name);

    const dbFieldName =
      fieldRo.dbFieldName ?? (await this.fieldService.generateDbFieldName(tableId, fieldName));

    if (fieldRo.dbFieldName) {
      const existField = await this.prismaService.txClient().field.findFirst({
        where: { tableId, dbFieldName: fieldRo.dbFieldName, deletedTime: null },
        select: { id: true },
      });
      if (existField) {
        throw new CustomHttpException(
          `Db Field name ${fieldRo.dbFieldName} already exists in this table`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.field.dbFieldNameAlreadyExists',
              context: { dbFieldName: fieldRo.dbFieldName },
            },
          }
        );
      }
    }

    const fieldVo: IFieldVo = {
      ...field,
      id: fieldId,
      name: fieldName,
      dbFieldName,
      isPending: field.isComputed ? true : undefined,
    };

    this.validateFormattingShowAs(fieldVo);
    this.validateAiConfig(fieldVo);

    return fieldVo;
  }

  async prepareCreateFields(tableId: string, fieldRos: IFieldRo[], batchFieldVos?: IFieldVo[]) {
    // throw error when dbFieldName is duplicated
    const fieldRoDbFieldNames = fieldRos
      .map((field) => field.dbFieldName)
      .filter((name) => name !== undefined && name !== null) as string[];

    if (fieldRoDbFieldNames.length) {
      const existedField = await this.prismaService.txClient().field.findFirst({
        where: { tableId, dbFieldName: { in: fieldRoDbFieldNames } },
        select: { id: true, dbFieldName: true },
      });

      if (existedField) {
        throw new CustomHttpException(
          `Db Field name ${existedField.dbFieldName} already exists in this table`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.field.dbFieldNameAlreadyExists',
              context: { dbFieldName: existedField.dbFieldName },
            },
          }
        );
      }
    }

    const fields: IFieldVo[] = (await Promise.all(
      fieldRos.map(
        async (fieldRo) => await this.prepareCreateFieldInner(tableId, fieldRo, batchFieldVos)
      )
    )) as IFieldVo[];

    const uniqFieldNames = await this.uniqFieldNames(
      tableId,
      fields.map((field) => field.name)
    );

    const dbFieldNames = await this.fieldService.generateDbFieldNames(tableId, uniqFieldNames);

    return fieldRos.map((fieldRo, index) => {
      const field = fields[index];
      const fieldId = field.id || generateFieldId();
      const fieldName = uniqFieldNames[index];
      const dbFieldName = fieldRo.dbFieldName ?? dbFieldNames[index];
      const fieldVo: IFieldVo = {
        ...field,
        id: fieldId,
        name: fieldName,
        dbFieldName,
        isPending: field.isComputed ? true : undefined,
      };
      this.validateFormattingShowAs(fieldVo);
      this.validateAiConfig(fieldVo);
      return fieldVo;
    });
  }

  async prepareUpdateField(
    tableId: string,
    fieldRo: IConvertFieldRo,
    oldFieldVo: IFieldVo
  ): Promise<IFieldVo> {
    const fieldVo = (await this.prepareUpdateFieldInner(
      tableId,
      {
        ...fieldRo,
        name: fieldRo.name ?? oldFieldVo.name,
        dbFieldName: fieldRo.dbFieldName ?? oldFieldVo.dbFieldName,
        description:
          fieldRo.description === undefined ? oldFieldVo.description : fieldRo.description,
      }, // for convenience, we fallback name adn dbFieldName when it be undefined
      oldFieldVo
    )) as IFieldVo;
    this.validateFormattingShowAs(fieldVo);
    this.validateAiConfig(fieldVo);

    return {
      ...fieldVo,
      id: oldFieldVo.id,
      isPrimary: oldFieldVo.isPrimary,
    };
  }

  async uniqFieldName(tableId: string, fieldName: string) {
    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { name: true },
    });

    const names = fieldRaw.map((item) => item.name);
    const uniqName = getUniqName(fieldName, names);
    if (uniqName !== fieldName) {
      return uniqName;
    }
    return fieldName;
  }

  private async uniqFieldNames(tableId: string, fieldNames: string[]) {
    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { name: true },
    });

    const names = fieldRaw.map((item) => item.name);

    return fieldNames.map((fieldName) => {
      const uniqName = getUniqName(fieldName, names);
      names.push(uniqName);
      return uniqName;
    });
  }

  async generateSymmetricField(tableId: string, field: LinkFieldDto) {
    if (!field.options.symmetricFieldId) {
      throw new CustomHttpException(
        'symmetricFieldId is required',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.symmetricFieldIdRequired',
          },
        }
      );
    }

    const prisma = this.prismaService.txClient();
    const { name: tableName, baseId } = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { name: true, baseId: true },
    });

    const fieldName = await this.uniqFieldName(tableId, tableName);

    // lookup field id is the primary field of the table to which it is linked
    const { id: lookupFieldId } = await prisma.field.findFirstOrThrow({
      where: { tableId, isPrimary: true },
      select: { id: true },
    });

    const relationship = RelationshipRevert[field.options.relationship];
    const isMultipleCellValue = isMultiValueLink(relationship) || undefined;
    const dbFieldName = await this.fieldService.generateDbFieldName(
      field.options.foreignTableId,
      fieldName
    );

    return createFieldInstanceByVo({
      id: field.options.symmetricFieldId,
      name: fieldName,
      dbFieldName,
      type: FieldType.Link,
      options: {
        baseId: field.options.baseId ? baseId : undefined,
        relationship,
        foreignTableId: tableId,
        lookupFieldId,
        fkHostTableName: field.options.fkHostTableName,
        selfKeyName: field.options.foreignKeyName,
        foreignKeyName: field.options.selfKeyName,
        symmetricFieldId: field.id,
      },
      isMultipleCellValue,
      dbFieldType: DbFieldType.Json,
      cellValueType: CellValueType.String,
      meta: {
        hasOrderColumn: field.getHasOrderColumn(),
      },
    } as IFieldVo) as LinkFieldDto;
  }

  async cleanForeignKey(options: ILinkFieldOptions) {
    const { fkHostTableName, relationship, selfKeyName, foreignKeyName, isOneWay } = options;
    const dropTable = async (tableName: string) => {
      // Use provider to generate dialect-correct DROP TABLE SQL
      const sql = this.dbProvider.dropTable(tableName);
      await this.prismaService.txClient().$executeRawUnsafe(sql);
    };

    const dropColumn = async (tableName: string, columnName: string) => {
      const sqls = this.dbProvider.dropColumnAndIndex(tableName, columnName, `index_${columnName}`);

      for (const sql of sqls) {
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }

      // Drop the associated order column if it exists
      const orderColumn = `${columnName}_order`;
      const exists = await this.dbProvider.checkColumnExist(
        tableName,
        orderColumn,
        this.prismaService.txClient()
      );
      if (exists) {
        const dropOrderSqls = this.dbProvider.dropColumnAndIndex(
          tableName,
          orderColumn,
          `index_${orderColumn}`
        );
        for (const sql of dropOrderSqls) {
          await this.prismaService.txClient().$executeRawUnsafe(sql);
        }
      }
    };

    if (relationship === Relationship.ManyMany && fkHostTableName.includes('junction_')) {
      await dropTable(fkHostTableName);
    }

    if (relationship === Relationship.ManyOne) {
      await dropColumn(fkHostTableName, foreignKeyName);
    }

    if (relationship === Relationship.OneMany) {
      if (isOneWay) {
        fkHostTableName.includes('junction_') && (await dropTable(fkHostTableName));
      } else {
        await dropColumn(fkHostTableName, selfKeyName);
      }
    }

    if (relationship === Relationship.OneOne) {
      await dropColumn(fkHostTableName, foreignKeyName === '__id' ? selfKeyName : foreignKeyName);
    }
  }

  async createReference(field: IFieldInstance) {
    if (field.isLookup) {
      return this.createComputedFieldReference(field);
    }

    switch (field.type) {
      case FieldType.Formula:
      case FieldType.Rollup:
      case FieldType.ConditionalRollup:
      case FieldType.Link:
        return this.createComputedFieldReference(field);
      default:
        break;
    }
  }

  async deleteReference(fieldId: string): Promise<string[]> {
    const prisma = this.prismaService.txClient();
    const refRaw = await prisma.reference.findMany({
      where: {
        fromFieldId: fieldId,
      },
    });

    await prisma.reference.deleteMany({
      where: {
        OR: [{ toFieldId: fieldId }, { fromFieldId: fieldId }],
      },
    });

    return refRaw.map((ref) => ref.toFieldId);
  }

  /**
   * the lookup field that attach to the deleted, should delete to field reference
   */
  async deleteLookupFieldReference(linkFieldId: string): Promise<string[]> {
    const prisma = this.prismaService.txClient();
    const fieldsRaw = await prisma.field.findMany({
      where: { lookupLinkedFieldId: linkFieldId, deletedTime: null },
      select: { id: true },
    });

    for (const field of fieldsRaw) {
      await prisma.field.update({
        data: { lookupLinkedFieldId: null },
        where: { id: field.id },
      });
    }

    const lookupFieldIds = fieldsRaw.map((field) => field.id);

    // just need delete to field id, because lookup field still exist
    await prisma.reference.deleteMany({
      where: {
        OR: [{ toFieldId: { in: lookupFieldIds } }],
      },
    });
    return lookupFieldIds;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  getFieldReferenceIds(field: IFieldInstance): string[] {
    if (field.lookupOptions && field.type !== FieldType.ConditionalRollup) {
      // Lookup/Rollup fields depend on BOTH the target lookup field and the link field.
      // This ensures when a link cell changes, the dependent lookup/rollup fields are
      // included in the computed impact and persisted via updateFromSelect.
      const refs: string[] = [];
      if (isLinkLookupOptions(field.lookupOptions)) {
        const { lookupFieldId, linkFieldId } = field.lookupOptions;
        if (lookupFieldId) refs.push(lookupFieldId);
        if (linkFieldId) refs.push(linkFieldId);
        return refs;
      }
    }

    if (field.isConditionalLookup) {
      const refs: string[] = [];
      const meta = field.getConditionalLookupOptions();
      const lookupFieldId = meta?.lookupFieldId;
      if (lookupFieldId) {
        refs.push(lookupFieldId);
      }
      const sortFieldId = meta?.sort?.fieldId;
      if (sortFieldId) {
        refs.push(sortFieldId);
      }
      const filterRefs = extractFieldIdsFromFilter(meta?.filter, true);
      filterRefs.forEach((fieldId) => refs.push(fieldId));
      return refs;
    }

    if (field.type === FieldType.ConditionalRollup) {
      const refs: string[] = [];
      const options = field.options as IConditionalRollupFieldOptions | undefined;
      const lookupFieldId = options?.lookupFieldId;
      if (lookupFieldId) {
        refs.push(lookupFieldId);
      }
      const sortFieldId = options?.sort?.fieldId;
      if (sortFieldId && ConditionalRollupFieldCore.supportsOrdering(options?.expression)) {
        refs.push(sortFieldId);
      }
      const filterRefs = extractFieldIdsFromFilter(options?.filter, true);
      filterRefs.forEach((fieldId) => refs.push(fieldId));
      return refs;
    }

    if (field.type === FieldType.Link) {
      return [field.options.lookupFieldId];
    }

    if (field.type === FieldType.Formula) {
      return (field as FormulaFieldDto).getReferenceFieldIds();
    }

    return [];
  }

  private async createComputedFieldReference(field: IFieldInstance) {
    const toFieldId = field.id;

    const graphItems = await this.referenceService.getFieldGraphItems([field.id]);
    let fieldIds = this.getFieldReferenceIds(field);

    // add lookupOptions filter fieldIds to reference
    if (field?.lookupOptions) {
      const lookupOptions = field.lookupOptions;
      if (isLinkLookupOptions(lookupOptions)) {
        const filterSetFieldIds = extractFieldIdsFromFilter(lookupOptions.filter);
        filterSetFieldIds.forEach((fieldId) => {
          fieldIds.push(fieldId);
        });
      }
    }

    const conditionalLookupOptions = field.getConditionalLookupOptions?.();
    if (conditionalLookupOptions) {
      const filterFieldIds = extractFieldIdsFromFilter(conditionalLookupOptions.filter, true);
      filterFieldIds.forEach((fieldId) => {
        fieldIds.push(fieldId);
      });
      if (conditionalLookupOptions.sort?.fieldId) {
        fieldIds.push(conditionalLookupOptions.sort.fieldId);
      }
    }

    if (field.type === FieldType.ConditionalRollup) {
      const options = field.options as IConditionalRollupFieldOptions | undefined;
      const filterFieldIds = extractFieldIdsFromFilter(options?.filter, true);
      filterFieldIds.forEach((fieldId) => {
        fieldIds.push(fieldId);
      });
      if (options?.sort?.fieldId) {
        fieldIds.push(options.sort.fieldId);
      }
    }

    fieldIds = uniq(fieldIds);
    fieldIds.forEach((fromFieldId) => {
      graphItems.push({ fromFieldId, toFieldId });
    });

    if (hasCycle(graphItems)) {
      throw new CustomHttpException(
        `Detected a cycle: ${field.id}[${field.name}] is part of a circular dependency`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.cycleDetectedCreateField',
            context: {
              id: field.id,
              name: field.name,
            },
          },
        }
      );
    }

    for (const fromFieldId of fieldIds) {
      await this.prismaService.txClient().reference.create({
        data: {
          fromFieldId,
          toFieldId,
        },
      });
    }
  }

  async createFieldTaskReference(tableId: string, field: IFieldInstance) {
    const { id: fieldId, aiConfig } = field;

    await this.prismaService.txClient().taskReference.deleteMany({
      where: { toFieldId: fieldId },
    });
    const existingFieldIds = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });

    const existingFieldIdSet = new Set(existingFieldIds.map(({ id }) => id));
    const { type } = aiConfig ?? {};

    if (type === FieldAIActionType.Customization) {
      const { prompt, attachmentFieldIds = [] } = aiConfig as ITextFieldCustomizeAIConfig;
      const fieldIds = extractFieldReferences(prompt);
      const allFieldIds = Array.from(new Set([...fieldIds, ...attachmentFieldIds]));
      const fieldIdsToCreate = allFieldIds.filter((id) => existingFieldIdSet.has(id));

      return await this.prismaService.txClient().taskReference.createMany({
        data: fieldIdsToCreate.map((id) => ({
          fromFieldId: id,
          toFieldId: fieldId,
        })),
      });
    }

    const { sourceFieldId } = (aiConfig as ITextFieldSummarizeAIConfig) ?? {};
    if (!sourceFieldId || !existingFieldIdSet.has(sourceFieldId)) return;

    await this.prismaService.txClient().taskReference.create({
      data: {
        fromFieldId: sourceFieldId,
        toFieldId: fieldId,
      },
    });
  }
}
