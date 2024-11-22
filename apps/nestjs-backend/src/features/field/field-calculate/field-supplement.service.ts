/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  IFormulaFieldOptions,
  ILinkFieldOptions,
  ILinkFieldOptionsRo,
  ILookupOptionsRo,
  ILookupOptionsVo,
  IRollupFieldOptions,
  ISelectFieldOptionsRo,
  IConvertFieldRo,
  IUserFieldOptions,
} from '@teable/core';
import {
  assertNever,
  AttachmentFieldCore,
  AutoNumberFieldCore,
  CellValueType,
  CheckboxFieldCore,
  ColorUtils,
  CreatedTimeFieldCore,
  DateFieldCore,
  DbFieldType,
  FieldType,
  generateChoiceId,
  generateFieldId,
  getDefaultFormatting,
  getFormattingSchema,
  getRandomString,
  getShowAsSchema,
  getUniqName,
  isMultiValueLink,
  LastModifiedTimeFieldCore,
  LongTextFieldCore,
  NumberFieldCore,
  RatingFieldCore,
  Relationship,
  RelationshipRevert,
  SelectFieldCore,
  SingleLineTextFieldCore,
  UserFieldCore,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { keyBy, merge, mergeWith } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import type { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { majorFieldKeysChanged } from '../../../utils/major-field-keys-changed';
import { ReferenceService } from '../../calculation/reference.service';
import { hasCycle } from '../../calculation/utils/dfs';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByVo } from '../model/factory';
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
    const tableRaw = await this.prismaService.tableMeta.findUnique({
      where: { id: foreignTableId },
      select: { name: true },
    });
    if (!tableRaw) {
      throw new BadRequestException(`foreignTableId ${foreignTableId} is invalid`);
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

    throw new BadRequestException('relationship is invalid');
  }

  async generateNewLinkOptionsVo(
    tableId: string,
    fieldId: string,
    optionsRo: ILinkFieldOptionsRo
  ): Promise<ILinkFieldOptions> {
    const { baseId, foreignTableId, isOneWay } = optionsRo;
    const symmetricFieldId = isOneWay ? undefined : generateFieldId();
    const dbTableName = await this.getDbTableName(tableId);
    const foreignTableName = await this.getDbTableName(foreignTableId);

    const { id: lookupFieldId } = await this.prismaService.field.findFirstOrThrow({
      where: { tableId: foreignTableId, isPrimary: true },
      select: { id: true },
    });

    if (baseId) {
      await this.prismaService.tableMeta
        .findFirstOrThrow({
          where: { id: foreignTableId, baseId, deletedTime: null },
          select: { id: true },
        })
        .catch(() => {
          throw new BadRequestException(
            `foreignTableId ${foreignTableId} is not exist in base ${baseId}`
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

    const symmetricFieldId = isOneWay
      ? undefined
      : oldOptions.foreignTableId === newOptionsRo.foreignTableId
        ? oldOptions.symmetricFieldId
        : generateFieldId();

    const lookupFieldId =
      oldOptions.foreignTableId === foreignTableId
        ? oldOptions.lookupFieldId
        : (
            await this.prismaService.field.findFirstOrThrow({
              where: { tableId: foreignTableId, isPrimary: true, deletedTime: null },
              select: { id: true },
            })
          ).id;

    if (baseId) {
      await this.prismaService.tableMeta
        .findFirstOrThrow({
          where: { id: foreignTableId, baseId, deletedTime: null },
          select: { id: true },
        })
        .catch(() => {
          throw new BadRequestException(
            `foreignTableId ${foreignTableId} is not exist in base ${baseId}`
          );
        });
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
    const options = field.options as ILinkFieldOptionsRo;
    const { relationship, foreignTableId } = options;

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
      return {
        ...oldFieldVo,
        ...fieldRo,
        options: {
          ...oldOptions,
          ...newOptionsRo,
          symmetricFieldId: newOptionsRo.isOneWay ? undefined : generateFieldId(),
        },
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
    };
  }

  private async prepareLookupOptions(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions } = field;
    if (!lookupOptions) {
      throw new BadRequestException('lookupOptions is required');
    }

    const { linkFieldId, lookupFieldId, foreignTableId } = lookupOptions;
    const linkFieldRaw = await this.prismaService.field.findFirst({
      where: { id: linkFieldId, deletedTime: null, type: FieldType.Link },
      select: { name: true, options: true, isMultipleCellValue: true },
    });

    const optionsRaw = linkFieldRaw?.options || null;
    const linkFieldOptions: ILinkFieldOptions =
      (optionsRaw && JSON.parse(optionsRaw as string)) ||
      batchFieldVos?.find((field) => field.id === linkFieldId)?.options;

    if (!linkFieldOptions || !linkFieldRaw) {
      throw new BadRequestException(`linkFieldId ${linkFieldId} is invalid`);
    }

    if (foreignTableId !== linkFieldOptions.foreignTableId) {
      throw new BadRequestException(`foreignTableId ${foreignTableId} is invalid`);
    }

    const lookupFieldRaw = await this.prismaService.field.findFirst({
      where: { id: lookupFieldId, deletedTime: null },
    });

    if (!lookupFieldRaw) {
      throw new BadRequestException(`Lookup field ${lookupFieldId} is not exist`);
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
    if (isMultipleCellValue) {
      return DbFieldType.Json;
    }

    if (
      [
        FieldType.Link,
        FieldType.User,
        FieldType.Attachment,
        FieldType.Button,
        FieldType.CreatedBy,
        FieldType.LastModifiedBy,
      ].includes(fieldType)
    ) {
      return DbFieldType.Json;
    }

    if (fieldType === FieldType.AutoNumber) {
      return DbFieldType.Integer;
    }

    switch (cellValueType) {
      case CellValueType.Number:
        return DbFieldType.Real;
      case CellValueType.DateTime:
        return DbFieldType.DateTime;
      case CellValueType.Boolean:
        return DbFieldType.Boolean;
      case CellValueType.String:
        return DbFieldType.Text;
      default:
        assertNever(cellValueType);
    }
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
      ...(formatting ? { formatting } : {}),
      ...(showAs ? { showAs } : {}),
    };
  }

  private async prepareLookupField(fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions, lookupFieldRaw, linkFieldRaw } = await this.prepareLookupOptions(
      fieldRo,
      batchFieldVos
    );

    if (lookupFieldRaw.type !== fieldRo.type) {
      throw new BadRequestException(
        `Current field type ${fieldRo.type} is not equal to lookup field (${lookupFieldRaw.type})`
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
    const newLookupOptions = fieldRo.lookupOptions as ILookupOptionsRo;
    const oldLookupOptions = oldFieldVo.lookupOptions as ILookupOptionsVo;
    if (
      oldFieldVo.isLookup &&
      newLookupOptions.lookupFieldId === oldLookupOptions.lookupFieldId &&
      newLookupOptions.linkFieldId === oldLookupOptions.linkFieldId &&
      newLookupOptions.foreignTableId === oldLookupOptions.foreignTableId
    ) {
      return merge(
        {},
        fieldRo.options
          ? {
              ...oldFieldVo,
              options: { ...oldFieldVo.options, showAs: undefined }, // clean showAs
            }
          : oldFieldVo,
        fieldRo
      );
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
      throw new BadRequestException('expression parse error');
    }

    const fieldRaws = await this.prismaService.field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
    });

    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const batchFields = batchFieldVos?.map((fieldVo) => createFieldInstanceByVo(fieldVo));
    const fieldMap = keyBy(fields.concat(batchFields || []), 'id');

    if (fieldIds.find((id) => !fieldMap[id])) {
      throw new BadRequestException(`formula field reference ${fieldIds.join()} not found`);
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
      throw new BadRequestException('rollup field options is required');
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
      throw new BadRequestException(`Parse rollup Error: ${e.message}`);
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

  private async prepareUpdateRollupField(fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    const newOptions = fieldRo.options as IRollupFieldOptions;
    const oldOptions = oldFieldVo.options as IRollupFieldOptions;

    if (!majorFieldKeysChanged(oldFieldVo, fieldRo)) {
      return { ...oldFieldVo, ...fieldRo };
    }

    const newLookupOptions = fieldRo.lookupOptions as ILookupOptionsRo;
    const oldLookupOptions = oldFieldVo.lookupOptions as ILookupOptionsVo;
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
        throw new BadRequestException(`choice name ${choice.name} is duplicated`);
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
      default:
        throw new Error('invalid field type');
    }
  }

  private async prepareUpdateFieldInner(tableId: string, fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    if (fieldRo.type !== oldFieldVo.type) {
      return this.prepareCreateFieldInner(tableId, fieldRo);
    }

    if (fieldRo.isLookup && majorFieldKeysChanged(oldFieldVo, fieldRo)) {
      return this.prepareUpdateLookupField(fieldRo, oldFieldVo);
    }

    switch (fieldRo.type) {
      case FieldType.Link: {
        return this.prepareUpdateLinkField(tableId, fieldRo, oldFieldVo);
      }
      case FieldType.Rollup:
        return this.prepareUpdateRollupField(fieldRo, oldFieldVo);
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
      case FieldType.LastModifiedBy:
        return this.prepareLastModifiedByField(fieldRo);
      case FieldType.CreatedBy:
        return this.prepareCreatedByField(fieldRo);
      default:
        throw new Error('invalid field type');
    }
  }

  private zodParse(schema: z.Schema, value: unknown) {
    const result = (schema as z.Schema).safeParse(value);

    if (!result.success) {
      throw new BadRequestException(fromZodError(result.error));
    }
  }

  private validateFormattingShowAs(field: IFieldVo) {
    const { cellValueType, isMultipleCellValue } = field;
    const showAsSchema = getShowAsSchema(cellValueType, isMultipleCellValue);

    const showAs = 'showAs' in field.options ? field.options.showAs : undefined;
    const formatting = 'formatting' in field.options ? field.options.formatting : undefined;

    if (showAs) {
      this.zodParse(showAsSchema, showAs);
    }

    if (formatting) {
      const formattingSchema = getFormattingSchema(cellValueType);
      this.zodParse(formattingSchema, formatting);
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
        where: { tableId, dbFieldName: fieldRo.dbFieldName },
        select: { id: true },
      });
      if (existField) {
        throw new BadRequestException(`dbFieldName ${fieldRo.dbFieldName} is duplicated`);
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

    return fieldVo;
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

    return {
      ...fieldVo,
      id: oldFieldVo.id,
      isPrimary: oldFieldVo.isPrimary,
    };
  }

  private async uniqFieldName(tableId: string, fieldName: string) {
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

  async generateSymmetricField(tableId: string, field: LinkFieldDto) {
    if (!field.options.symmetricFieldId) {
      throw new Error('symmetricFieldId is required');
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
    } as IFieldVo) as LinkFieldDto;
  }

  async createForeignKey(options: ILinkFieldOptions) {
    const { relationship, fkHostTableName, selfKeyName, foreignKeyName, isOneWay } = options;

    let alterTableSchema: Knex.SchemaBuilder | undefined;

    if (relationship === Relationship.ManyMany) {
      alterTableSchema = this.knex.schema.createTable(fkHostTableName, (table) => {
        table.increments('__id').primary();
        table.string(selfKeyName);
        table.string(foreignKeyName);

        table.index([foreignKeyName], `index_${foreignKeyName}`);
        table.unique([selfKeyName, foreignKeyName], {
          indexName: `index_${selfKeyName}_${foreignKeyName}`,
        });
      });
    }

    if (relationship === Relationship.ManyOne) {
      alterTableSchema = this.knex.schema.alterTable(fkHostTableName, (table) => {
        table.string(foreignKeyName);
        table.index([foreignKeyName], `index_${foreignKeyName}`);
      });
    }

    if (relationship === Relationship.OneMany) {
      if (isOneWay) {
        alterTableSchema = this.knex.schema.createTable(fkHostTableName, (table) => {
          table.increments('__id').primary();
          table.string(selfKeyName);
          table.string(foreignKeyName);

          table.index([foreignKeyName], `index_${foreignKeyName}`);
          table.unique([selfKeyName, foreignKeyName], {
            indexName: `index_${selfKeyName}_${foreignKeyName}`,
          });
        });
      } else {
        alterTableSchema = this.knex.schema.alterTable(fkHostTableName, (table) => {
          table.string(selfKeyName);
          table.index([selfKeyName], `index_${selfKeyName}`);
        });
      }
    }

    // assume options is from the main field (user created one)
    if (relationship === Relationship.OneOne) {
      alterTableSchema = this.knex.schema.alterTable(fkHostTableName, (table) => {
        if (foreignKeyName === '__id') {
          throw new Error('can not use __id for foreignKeyName');
        }
        table.string(foreignKeyName);
        table.unique([foreignKeyName], {
          indexName: `index_${foreignKeyName}`,
        });
      });
    }

    if (!alterTableSchema) {
      throw new Error('alterTableSchema is undefined');
    }

    for (const sql of alterTableSchema.toSQL()) {
      await this.prismaService.txClient().$executeRawUnsafe(sql.sql);
    }
  }

  async cleanForeignKey(options: ILinkFieldOptions) {
    const { fkHostTableName, relationship, selfKeyName, foreignKeyName, isOneWay } = options;
    const dropTable = async (tableName: string) => {
      const alterTableSchema = this.knex.schema.dropTable(tableName);

      for (const sql of alterTableSchema.toSQL()) {
        await this.prismaService.txClient().$executeRawUnsafe(sql.sql);
      }
    };

    const dropColumn = async (tableName: string, columnName: string) => {
      const alterTableQuery = this.dbProvider.dropColumnAndIndex(
        tableName,
        columnName,
        `index_${columnName}`
      );

      for (const query of alterTableQuery) {
        await this.prismaService.txClient().$executeRawUnsafe(query);
      }
    };

    if (relationship === Relationship.ManyMany) {
      await dropTable(fkHostTableName);
    }

    if (relationship === Relationship.ManyOne) {
      await dropColumn(fkHostTableName, foreignKeyName);
    }

    if (relationship === Relationship.OneMany) {
      if (isOneWay) {
        await dropTable(fkHostTableName);
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

  getFieldReferenceIds(field: IFieldInstance): string[] {
    if (field.lookupOptions) {
      return [field.lookupOptions.lookupFieldId];
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
    const fieldIds = this.getFieldReferenceIds(field);

    fieldIds.forEach((fromFieldId) => {
      graphItems.push({ fromFieldId, toFieldId });
    });

    if (hasCycle(graphItems)) {
      throw new BadRequestException('field reference has cycle');
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
}
