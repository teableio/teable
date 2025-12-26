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
import type {
  AttachmentField,
  ButtonField,
  CheckboxField,
  DateField,
  Field,
  FieldId,
  IFieldVisitor,
  LinkField,
  LongTextField,
  MultipleSelectField,
  NumberField,
  RatingField,
  FormulaField,
  SingleSelectField,
  Table,
  SingleLineTextField,
  UserField,
  ViewColumnMetaValue,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { sequenceResults } from '../shared/neverthrow';

const columnMetaEntrySchema = z
  .object({
    order: z.number(),
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

const baseFieldDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  dbFieldName: z.string().optional(),
  isPrimary: z.boolean(),
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

const linkMetaSchema = z.object({
  hasOrderColumn: z.boolean().optional(),
});

type SingleLineTextOptionsDto = z.infer<typeof singleLineTextOptionsSchema>;
type LongTextOptionsDto = z.infer<typeof longTextOptionsSchema>;
type NumberOptionsDto = z.infer<typeof numberOptionsSchema>;
type RatingOptionsDto = z.infer<typeof ratingOptionsSchema>;
type SelectOptionsDto = z.infer<typeof selectOptionsSchema>;
type CheckboxOptionsDto = z.infer<typeof checkboxOptionsSchema>;
type DateOptionsDto = z.infer<typeof dateOptionsSchema>;
type UserOptionsDto = z.infer<typeof userOptionsSchema>;
type ButtonOptionsDto = z.infer<typeof buttonOptionsSchema>;
type FormulaOptionsDto = z.infer<typeof formulaOptionsSchema>;

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
    type: z.literal('user'),
    options: userOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('button'),
    options: buttonOptionsSchema.optional(),
  }),
  baseFieldDtoSchema.extend({
    type: z.literal('link'),
    options: linkOptionsSchema,
    meta: linkMetaSchema.optional(),
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

  visitSingleLineTextField(field: SingleLineTextField): Result<IFieldDto, string> {
    const options: SingleLineTextOptionsDto = {};
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'singleLineText',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitLongTextField(field: LongTextField): Result<IFieldDto, string> {
    const options: LongTextOptionsDto = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'longText',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitNumberField(field: NumberField): Result<IFieldDto, string> {
    const options: NumberOptionsDto = {
      formatting: field.formatting().toDto(),
    };
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toNumber();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'number',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitRatingField(field: RatingField): Result<IFieldDto, string> {
    const options: RatingOptionsDto = {
      icon: field.ratingIcon().toString() as RatingOptionsDto['icon'],
      color: field.ratingColor().toString() as RatingOptionsDto['color'],
      max: field.ratingMax().toNumber(),
    };

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'rating',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitFormulaField(field: FormulaField): Result<IFieldDto, string> {
    const options: FormulaOptionsDto = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field.isMultipleCellValue().map((isMultipleCellValue) => ({
          cellValueType,
          isMultipleCellValue,
        }))
      )
      .map(({ cellValueType, isMultipleCellValue }) => ({
        id: field.id().toString(),
        name: field.name().toString(),
        dbFieldName: this.optionalDbFieldName(field),
        type: 'formula',
        options,
        cellValueType: cellValueType.toString(),
        isMultipleCellValue: isMultipleCellValue.toBoolean(),
        isPrimary: field.id().equals(this.primaryFieldId),
      }));
  }

  visitSingleSelectField(field: SingleSelectField): Result<IFieldDto, string> {
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
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'singleSelect',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<IFieldDto, string> {
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
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'multipleSelect',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitCheckboxField(field: CheckboxField): Result<IFieldDto, string> {
    const options: CheckboxOptionsDto = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toBoolean();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'checkbox',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitAttachmentField(field: AttachmentField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'attachment',
      options: {},
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitDateField(field: DateField): Result<IFieldDto, string> {
    const options: DateOptionsDto = {
      formatting: field.formatting().toDto() as DateOptionsDto['formatting'],
    };
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'date',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitUserField(field: UserField): Result<IFieldDto, string> {
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
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'user',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitButtonField(field: ButtonField): Result<IFieldDto, string> {
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
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'button',
      options,
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitLinkField(field: LinkField): Result<IFieldDto, string> {
    return field.configDto().map((options) => ({
      id: field.id().toString(),
      name: field.name().toString(),
      dbFieldName: this.optionalDbFieldName(field),
      type: 'link',
      options,
      meta: field.metaDto(),
      isPrimary: field.id().equals(this.primaryFieldId),
    }));
  }
}

export const mapFieldToDto = (field: Field, primaryFieldId: FieldId): Result<IFieldDto, string> =>
  field.accept(new FieldToDtoVisitor(primaryFieldId));

export const mapTableToDto = (table: Table): Result<ITableDto, string> => {
  const primaryFieldId = table.primaryFieldId();
  const dbTableNameResult = table.dbTableName().andThen((name) => name.value());
  const dbTableName = dbTableNameResult.isOk() ? dbTableNameResult.value : undefined;
  const fieldsResult = sequenceResults(table.fields().map((f) => mapFieldToDto(f, primaryFieldId)));
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
