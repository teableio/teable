import type {
  AttachmentField,
  AutoNumberField,
  ButtonField,
  CheckboxField,
  ConditionalLookupField,
  ConditionalRollupField,
  CreatedByField,
  CreatedTimeField,
  DateField,
  Field,
  FieldId,
  IFieldVisitor,
  LastModifiedByField,
  LastModifiedTimeField,
  LinkField,
  LongTextField,
  LookupField,
  MultipleSelectField,
  NumberField,
  RatingField,
  FormulaField,
  RollupField,
  SingleSelectField,
  Table,
  SingleLineTextField,
  UserField,
  ViewColumnMetaValue,
  DomainError,
} from '@teable/v2-core';
import {
  fieldColorValues,
  ratingColorValues,
  ratingIconValues,
  singleLineTextShowAsValues,
  NumberFormattingType,
  MultiNumberDisplayType,
  SingleNumberDisplayType,
  TimeFormatting,
  TIME_ZONE_LIST,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { sequenceResults } from '../shared/neverthrow';

const columnMetaEntrySchema = z
  .object({
    order: z.number().nullable().optional(),
    visible: z.boolean().optional(),
    hidden: z.boolean().optional(),
    width: z.number().optional(),
    required: z.boolean().optional(),
    statisticFunc: z.string().nullable().optional(),
  })
  .passthrough();

const columnMetaSchema = z.record(z.string(), columnMetaEntrySchema);

export const viewDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']),
  columnMeta: columnMetaSchema,
});

export type IViewDto = Omit<z.infer<typeof viewDtoSchema>, 'columnMeta'> & {
  columnMeta: ViewColumnMetaValue;
};

const conditionSortSchema = z.object({
  fieldId: z.string(),
  order: z.enum(['asc', 'desc']),
});

const filterItemSchema = z.object({
  fieldId: z.string(),
  operator: z.string(),
  value: z.unknown().optional(),
  isSymbol: z.boolean().optional(),
});

const baseFilterSetSchema = z.object({
  conjunction: z.enum(['and', 'or']),
});

type FilterSetType = z.infer<typeof baseFilterSetSchema> & {
  filterSet: Array<z.infer<typeof filterItemSchema> | FilterSetType>;
};

const nestedFilterSchema: z.ZodType<FilterSetType> = baseFilterSetSchema.extend({
  filterSet: z.lazy(() => z.union([filterItemSchema, nestedFilterSchema]).array()),
});

const fieldConditionSchema = z.object({
  filter: nestedFilterSchema.nullable().optional(),
  sort: conditionSortSchema.optional(),
  limit: z.number().optional(),
});

const lookupOptionsSchema = z.object({
  linkFieldId: z.string(),
  foreignTableId: z.string(),
  lookupFieldId: z.string(),
  filter: fieldConditionSchema.shape.filter,
  sort: fieldConditionSchema.shape.sort,
  limit: fieldConditionSchema.shape.limit,
});

const conditionalLookupOptionsSchema = z.object({
  foreignTableId: z.string(),
  lookupFieldId: z.string(),
  condition: fieldConditionSchema,
});

const conditionalRollupConfigSchema = z.object({
  foreignTableId: z.string(),
  lookupFieldId: z.string(),
  condition: fieldConditionSchema,
});

const baseFieldDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  dbFieldName: z.string().optional(),
  isPrimary: z.boolean(),
  notNull: z.boolean().optional(),
  unique: z.boolean().optional(),
  isComputed: z.boolean().optional(),
  isLookup: z.boolean().optional(),
  lookupOptions: lookupOptionsSchema.optional(),
  conditionalLookupOptions: conditionalLookupOptionsSchema.optional(),
});

const fieldColorSchema = z.enum(fieldColorValues);
const ratingIconSchema = z.enum(ratingIconValues);
const ratingColorSchema = z.enum(ratingColorValues);

const singleLineTextShowAsSchema = z.object({
  type: z.enum(singleLineTextShowAsValues),
});

const numberFormattingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(NumberFormattingType.Decimal),
    precision: z.number(),
  }),
  z.object({
    type: z.literal(NumberFormattingType.Percent),
    precision: z.number(),
  }),
  z.object({
    type: z.literal(NumberFormattingType.Currency),
    precision: z.number(),
    symbol: z.string(),
  }),
]);

const numberShowAsSchema = z.union([
  z.object({
    type: z.enum([SingleNumberDisplayType.Bar, SingleNumberDisplayType.Ring]),
    color: fieldColorSchema,
    showValue: z.boolean(),
    maxValue: z.number(),
  }),
  z.object({
    type: z.enum([MultiNumberDisplayType.Bar, MultiNumberDisplayType.Line]),
    color: fieldColorSchema,
  }),
]);

const singleLineTextOptionsSchema = z.object({
  showAs: singleLineTextShowAsSchema.optional(),
  defaultValue: z.string().optional(),
});

const longTextOptionsSchema = z.object({
  defaultValue: z.string().optional(),
});

const numberOptionsSchema = z.object({
  formatting: numberFormattingSchema,
  showAs: numberShowAsSchema.optional(),
  defaultValue: z.number().optional(),
});

const ratingOptionsSchema = z.object({
  icon: ratingIconSchema.optional(),
  color: ratingColorSchema.optional(),
  max: z.number().optional(),
});

const selectChoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: fieldColorSchema,
});

const selectOptionsSchema = z.object({
  choices: z.array(selectChoiceSchema),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
  preventAutoNewOptions: z.boolean().optional(),
});

const checkboxOptionsSchema = z.object({
  defaultValue: z.boolean().optional(),
});

const dateFormattingSchema = z.object({
  date: z.string(),
  time: z.enum([TimeFormatting.Hour24, TimeFormatting.Hour12, TimeFormatting.None]),
  timeZone: z.enum(TIME_ZONE_LIST),
});

const dateOptionsSchema = z.object({
  formatting: dateFormattingSchema,
  defaultValue: z.enum(['now']).optional(),
});

const createdTimeOptionsSchema = z.object({
  expression: z.string().optional(),
  formatting: dateFormattingSchema.optional(),
});

const lastModifiedTimeOptionsSchema = z.object({
  expression: z.string().optional(),
  formatting: dateFormattingSchema.optional(),
  trackedFieldIds: z.array(z.string()).optional(),
});

const createdByOptionsSchema = z.object({});

const lastModifiedByOptionsSchema = z.object({
  trackedFieldIds: z.array(z.string()).optional(),
});

const autoNumberOptionsSchema = z.object({
  expression: z.string().optional(),
});

const userOptionsSchema = z.object({
  isMultiple: z.boolean().optional(),
  shouldNotify: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
});

const buttonWorkflowSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  isActive: z.boolean().optional(),
});

const buttonOptionsSchema = z.object({
  label: z.string().optional(),
  color: fieldColorSchema.optional(),
  maxCount: z.number().optional(),
  resetCount: z.boolean().optional(),
  workflow: buttonWorkflowSchema.optional().nullable(),
});

const cellValueTypeSchema = z.enum(['string', 'number', 'boolean', 'dateTime']);

const formulaFormattingSchema = z.union([numberFormattingSchema, dateFormattingSchema]);

const formulaShowAsSchema = z.union([singleLineTextShowAsSchema, numberShowAsSchema]);

const formulaOptionsSchema = z.object({
  expression: z.string(),
  timeZone: z.enum(TIME_ZONE_LIST).optional(),
  formatting: formulaFormattingSchema.optional(),
  showAs: formulaShowAsSchema.optional(),
});

const rollupOptionsSchema = z.object({
  expression: z.string(),
  timeZone: z.enum(TIME_ZONE_LIST).optional(),
  formatting: formulaFormattingSchema.optional(),
  showAs: formulaShowAsSchema.optional(),
});

const rollupConfigSchema = z.object({
  linkFieldId: z.string(),
  foreignTableId: z.string(),
  lookupFieldId: z.string(),
});

const linkRelationshipSchema = z.enum(['oneOne', 'manyMany', 'oneMany', 'manyOne']);

const linkOptionsSchema = z.object({
  baseId: z.string().optional(),
  relationship: linkRelationshipSchema,
  foreignTableId: z.string(),
  lookupFieldId: z.string(),
  isOneWay: z.boolean().optional(),
  fkHostTableName: z.string().optional(),
  selfKeyName: z.string().optional(),
  foreignKeyName: z.string().optional(),
  symmetricFieldId: z.string().optional(),
  filterByViewId: z.string().nullable().optional(),
  visibleFieldIds: z.array(z.string()).readonly().nullable().optional(),
});

type SingleLineTextOptionsDto = z.infer<typeof singleLineTextOptionsSchema>;
type LongTextOptionsDto = z.infer<typeof longTextOptionsSchema>;
type NumberOptionsDto = z.infer<typeof numberOptionsSchema>;
type RatingOptionsDto = z.infer<typeof ratingOptionsSchema>;
type SelectOptionsDto = z.infer<typeof selectOptionsSchema>;
type CheckboxOptionsDto = z.infer<typeof checkboxOptionsSchema>;
type DateOptionsDto = z.infer<typeof dateOptionsSchema>;
type CreatedTimeOptionsDto = z.infer<typeof createdTimeOptionsSchema>;
type LastModifiedTimeOptionsDto = z.infer<typeof lastModifiedTimeOptionsSchema>;
type CreatedByOptionsDto = z.infer<typeof createdByOptionsSchema>;
type LastModifiedByOptionsDto = z.infer<typeof lastModifiedByOptionsSchema>;
type AutoNumberOptionsDto = z.infer<typeof autoNumberOptionsSchema>;
type UserOptionsDto = z.infer<typeof userOptionsSchema>;
type ButtonOptionsDto = z.infer<typeof buttonOptionsSchema>;
type FormulaOptionsDto = z.infer<typeof formulaOptionsSchema>;
type RollupOptionsDto = z.infer<typeof rollupOptionsSchema>;
type RollupConfigDto = z.infer<typeof rollupConfigSchema>;
type ConditionalRollupConfigDto = z.infer<typeof conditionalRollupConfigSchema>;

export const fieldDtoSchema = z.discriminatedUnion('type', [
  baseFieldDtoSchema.extend({
    type: z.literal('singleLineText'),
    options: singleLineTextOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('longText'),
    options: longTextOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('number'),
    options: numberOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('rating'),
    options: ratingOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('formula'),
    options: formulaOptionsSchema,
    cellValueType: cellValueTypeSchema.optional(),
    isMultipleCellValue: z.boolean().optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('rollup'),
    options: rollupOptionsSchema,
    config: rollupConfigSchema,
    cellValueType: cellValueTypeSchema.optional(),
    isMultipleCellValue: z.boolean().optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('conditionalRollup'),
    options: rollupOptionsSchema,
    config: conditionalRollupConfigSchema,
    cellValueType: cellValueTypeSchema.optional(),
    isMultipleCellValue: z.boolean().optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('singleSelect'),
    options: selectOptionsSchema,
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('multipleSelect'),
    options: selectOptionsSchema,
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('checkbox'),
    options: checkboxOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('attachment'),
    options: z.object({}).optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('date'),
    options: dateOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('createdTime'),
    options: createdTimeOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('lastModifiedTime'),
    options: lastModifiedTimeOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('user'),
    options: userOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('createdBy'),
    options: createdByOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('lastModifiedBy'),
    options: lastModifiedByOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('autoNumber'),
    options: autoNumberOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('button'),
    options: buttonOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('link'),
    options: linkOptionsSchema,
  }),
]);

export type IFieldDto = z.infer<typeof fieldDtoSchema>;

export const tableDtoSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  name: z.string(),
  dbTableName: z.string().optional(),
  fields: z.array(fieldDtoSchema),
  views: z.array(viewDtoSchema),
});

export type ITableDto = z.infer<typeof tableDtoSchema>;

class FieldToDtoVisitor implements IFieldVisitor<IFieldDto> {
  constructor(private readonly primaryFieldId: FieldId) {}

  private optionalDbFieldName(field: Field): string | undefined {
    const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
    return dbFieldNameResult.isOk() ? dbFieldNameResult.value : undefined;
  }

  private baseField(field: Field): {
    id: string;
    name: string;
    dbFieldName?: string;
    isPrimary: boolean;
    notNull?: boolean;
    unique?: boolean;
    isComputed?: boolean;
  } {
    const notNull = field.notNull().toBoolean();
    const unique = field.unique().toBoolean();
    const isComputed = field.computed().toBoolean();

    return {
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      isPrimary: field.id().equals(this.primaryFieldId),
      ...(notNull ? { notNull } : {}),
      ...(unique ? { unique } : {}),
      ...(isComputed ? { isComputed } : {}),
    };
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<IFieldDto, DomainError> {
    const options: SingleLineTextOptionsDto = {};
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      ...this.baseField(field),
      type: 'singleLineText',
      options,
    });
  }

  visitLongTextField(field: LongTextField): Result<IFieldDto, DomainError> {
    const options: LongTextOptionsDto = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      ...this.baseField(field),
      type: 'longText',
      options,
    });
  }

  visitNumberField(field: NumberField): Result<IFieldDto, DomainError> {
    const options: NumberOptionsDto = {
      formatting: field.formatting().toDto(),
    };
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toNumber();

    return ok({
      ...this.baseField(field),
      type: 'number',
      options,
    });
  }

  visitRatingField(field: RatingField): Result<IFieldDto, DomainError> {
    const options: RatingOptionsDto = {
      icon: field.ratingIcon().toString() as RatingOptionsDto['icon'],
      color: field.ratingColor().toString() as RatingOptionsDto['color'],
      max: field.ratingMax().toNumber(),
    };

    return ok({
      ...this.baseField(field),
      type: 'rating',
      options,
    });
  }

  visitFormulaField(field: FormulaField): Result<IFieldDto, DomainError> {
    const options: FormulaOptionsDto = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const base = {
      ...this.baseField(field),
      type: 'formula' as const,
      options,
    };
    const resultType = field.cellValueType().andThen((cellValueType) =>
      field.isMultipleCellValue().map((isMultipleCellValue) => ({
        cellValueType,
        isMultipleCellValue,
      }))
    );
    if (resultType.isErr()) {
      return ok(base);
    }
    return ok({
      ...base,
      cellValueType: resultType.value.cellValueType.toString(),
      isMultipleCellValue: resultType.value.isMultipleCellValue.toBoolean(),
    });
  }

  visitRollupField(field: RollupField): Result<IFieldDto, DomainError> {
    const options: RollupOptionsDto = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const config: RollupConfigDto = field.configDto();

    const base = {
      ...this.baseField(field),
      type: 'rollup' as const,
      options,
      config,
    };
    const resultType = field.cellValueType().andThen((cellValueType) =>
      field.isMultipleCellValue().map((isMultipleCellValue) => ({
        cellValueType,
        isMultipleCellValue,
      }))
    );
    if (resultType.isErr()) {
      return ok(base);
    }
    return ok({
      ...base,
      cellValueType: resultType.value.cellValueType.toString(),
      isMultipleCellValue: resultType.value.isMultipleCellValue.toBoolean(),
    });
  }

  visitConditionalRollupField(field: ConditionalRollupField): Result<IFieldDto, DomainError> {
    const options: RollupOptionsDto = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const config: ConditionalRollupConfigDto = field.configDto();

    const base = {
      ...this.baseField(field),
      type: 'conditionalRollup' as const,
      options,
      config,
    };
    const resultType = field.cellValueType().andThen((cellValueType) =>
      field.isMultipleCellValue().map((isMultipleCellValue) => ({
        cellValueType,
        isMultipleCellValue,
      }))
    );
    if (resultType.isErr()) {
      return ok(base);
    }
    return ok({
      ...base,
      cellValueType: resultType.value.cellValueType.toString(),
      isMultipleCellValue: resultType.value.isMultipleCellValue.toBoolean(),
    });
  }

  visitSingleSelectField(field: SingleSelectField): Result<IFieldDto, DomainError> {
    const defaultValue = field.defaultValue();
    const preventAutoNewOptions = field.preventAutoNewOptions().toBoolean();
    const choices = field
      .selectOptions()
      .map((option) => option.toDto()) as SelectOptionsDto['choices'];
    const options: SelectOptionsDto = {
      choices,
      ...(defaultValue ? { defaultValue: defaultValue.toDto() } : {}),
      ...(preventAutoNewOptions ? { preventAutoNewOptions } : {}),
    };

    return ok({
      ...this.baseField(field),
      type: 'singleSelect',
      options,
    });
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<IFieldDto, DomainError> {
    const defaultValue = field.defaultValue();
    const preventAutoNewOptions = field.preventAutoNewOptions().toBoolean();
    const choices = field
      .selectOptions()
      .map((option) => option.toDto()) as SelectOptionsDto['choices'];
    const options: SelectOptionsDto = {
      choices,
      ...(defaultValue ? { defaultValue: defaultValue.toDto() } : {}),
      ...(preventAutoNewOptions ? { preventAutoNewOptions } : {}),
    };

    return ok({
      ...this.baseField(field),
      type: 'multipleSelect',
      options,
    });
  }

  visitCheckboxField(field: CheckboxField): Result<IFieldDto, DomainError> {
    const options: CheckboxOptionsDto = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toBoolean();

    return ok({
      ...this.baseField(field),
      type: 'checkbox',
      options,
    });
  }

  visitAttachmentField(field: AttachmentField): Result<IFieldDto, DomainError> {
    return ok({
      ...this.baseField(field),
      type: 'attachment',
      options: {},
    });
  }

  visitDateField(field: DateField): Result<IFieldDto, DomainError> {
    const options: DateOptionsDto = {
      formatting: field.formatting().toDto() as DateOptionsDto['formatting'],
    };
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      ...this.baseField(field),
      type: 'date',
      options,
    });
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<IFieldDto, DomainError> {
    const options: CreatedTimeOptionsDto = {
      expression: field.expression().toString(),
      formatting: field.formatting().toDto() as DateOptionsDto['formatting'],
    };
    return ok({
      ...this.baseField(field),
      type: 'createdTime',
      options,
    });
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<IFieldDto, DomainError> {
    const trackedFieldIds = field.trackedFieldIds().map((id) => id.toString());
    const options: LastModifiedTimeOptionsDto = {
      expression: field.expression().toString(),
      formatting: field.formatting().toDto() as DateOptionsDto['formatting'],
      ...(trackedFieldIds.length > 0 ? { trackedFieldIds } : {}),
    };
    return ok({
      ...this.baseField(field),
      type: 'lastModifiedTime',
      options,
    });
  }

  visitUserField(field: UserField): Result<IFieldDto, DomainError> {
    const defaultValue = field.defaultValue();
    const defaultValueDto = defaultValue?.toDto();
    const normalizedDefaultValue = Array.isArray(defaultValueDto)
      ? [...defaultValueDto]
      : defaultValueDto;
    const options: UserOptionsDto = {
      isMultiple: field.multiplicity().toBoolean(),
      shouldNotify: field.notification().toBoolean(),
      ...(normalizedDefaultValue !== undefined ? { defaultValue: normalizedDefaultValue } : {}),
    };

    return ok({
      ...this.baseField(field),
      type: 'user',
      options,
    });
  }

  visitCreatedByField(field: CreatedByField): Result<IFieldDto, DomainError> {
    const options: CreatedByOptionsDto = {};
    return ok({
      ...this.baseField(field),
      type: 'createdBy',
      options,
    });
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<IFieldDto, DomainError> {
    const trackedFieldIds = field.trackedFieldIds().map((id) => id.toString());
    const options: LastModifiedByOptionsDto = {
      ...(trackedFieldIds.length > 0 ? { trackedFieldIds } : {}),
    };
    return ok({
      ...this.baseField(field),
      type: 'lastModifiedBy',
      options,
    });
  }

  visitAutoNumberField(field: AutoNumberField): Result<IFieldDto, DomainError> {
    const options: AutoNumberOptionsDto = {
      expression: field.expression().toString(),
    };
    return ok({
      ...this.baseField(field),
      type: 'autoNumber',
      options,
    });
  }

  visitButtonField(field: ButtonField): Result<IFieldDto, DomainError> {
    const maxCount = field.maxCount();
    const resetCount = field.resetCount();
    const workflow = field.workflow();
    const options: ButtonOptionsDto = {
      label: field.label().toString(),
      color: field.color().toString() as ButtonOptionsDto['color'],
      ...(maxCount ? { maxCount: maxCount.toNumber() } : {}),
      ...(resetCount ? { resetCount: resetCount.toBoolean() } : {}),
      ...(workflow ? { workflow: workflow.toDto() } : {}),
    };

    return ok({
      ...this.baseField(field),
      type: 'button',
      options,
    });
  }

  visitLinkField(field: LinkField): Result<IFieldDto, DomainError> {
    return field.configDto().map((options) => ({
      ...this.baseField(field),
      type: 'link',
      options,
      meta: field.metaDto(),
    }));
  }

  visitLookupField(field: LookupField): Result<IFieldDto, DomainError> {
    const lookupOptions = field.lookupOptionsDto();

    const baseField = this.baseField(field);

    // For pending lookup fields, return minimal DTO with singleLineText as default type
    if (field.isPending()) {
      return ok({
        ...baseField,
        type: 'singleLineText',
        isLookup: true,
        lookupOptions,
      });
    }

    // Lookup fields delegate to the inner field's visitor, adding isLookup and lookupOptions
    const innerResult = field.innerField().andThen((inner) => inner.accept(this));
    if (innerResult.isErr()) return innerResult;

    const innerDto = innerResult.value;
    return ok({
      ...innerDto,
      ...baseField,
      isLookup: true,
      lookupOptions,
    });
  }

  visitConditionalLookupField(field: ConditionalLookupField): Result<IFieldDto, DomainError> {
    const conditionalLookupOptions = field.conditionalLookupOptionsDto();
    const baseField = this.baseField(field);

    // For pending lookup fields, return minimal DTO with singleLineText as default type
    if (field.isPending()) {
      return ok({
        ...baseField,
        type: 'singleLineText',
        isLookup: true,
        conditionalLookupOptions,
      });
    }

    const innerResult = field.innerField().andThen((inner) => inner.accept(this));
    if (innerResult.isErr()) return innerResult;

    const innerDto = innerResult.value;
    return ok({
      ...innerDto,
      ...baseField,
      isLookup: true,
      conditionalLookupOptions,
    });
  }
}

export const mapFieldToDto = (
  field: Field,
  primaryFieldId: FieldId
): Result<IFieldDto, DomainError> => field.accept(new FieldToDtoVisitor(primaryFieldId));

export const mapTableToDto = (table: Table): Result<ITableDto, DomainError> => {
  const primaryFieldId = table.primaryFieldId();
  const dbTableNameResult = table.dbTableName().andThen((name) => name.value());
  const dbTableName = dbTableNameResult.isOk() ? dbTableNameResult.value : undefined;
  const fieldsResult = sequenceResults(
    table.getFields().map((f) => mapFieldToDto(f, primaryFieldId))
  );
  const viewsResult = sequenceResults(
    table.views().map((view) =>
      view.columnMeta().map((columnMeta) => ({
        id: view.id().toString(),
        name: view.name().toString(),
        type: view.type().toString(),
        columnMeta: columnMeta.toDto(),
      }))
    )
  );

  return fieldsResult.andThen((fields) =>
    viewsResult.map((views) => ({
      id: table.id().toString(),
      baseId: table.baseId().toString(),
      name: table.name().toString(),
      dbTableName,
      fields: [...fields],
      views: [...views],
    }))
  );
};
