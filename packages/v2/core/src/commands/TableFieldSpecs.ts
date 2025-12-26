import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { z } from 'zod';

import type { BaseId } from '../domain/base/BaseId';
import type { Field } from '../domain/table/fields/Field';
import {
  createAttachmentField,
  createButtonField,
  createCheckboxField,
  createDateField,
  createFormulaField,
  createNewLinkField,
  createLongTextField,
  createMultipleSelectField,
  createNumberField,
  createRatingField,
  createSingleLineTextField,
  createSingleSelectField,
  createUserField,
} from '../domain/table/fields/FieldFactory';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { TableId } from '../domain/table/TableId';
import { ButtonLabel } from '../domain/table/fields/types/ButtonLabel';
import { ButtonMaxCount } from '../domain/table/fields/types/ButtonMaxCount';
import { ButtonResetCount } from '../domain/table/fields/types/ButtonResetCount';
import { ButtonWorkflow } from '../domain/table/fields/types/ButtonWorkflow';
import { CheckboxDefaultValue } from '../domain/table/fields/types/CheckboxDefaultValue';
import { DateDefaultValue } from '../domain/table/fields/types/DateDefaultValue';
import {
  DateTimeFormatting,
  TimeFormatting,
} from '../domain/table/fields/types/DateTimeFormatting';
import { FieldColor, fieldColorValues } from '../domain/table/fields/types/FieldColor';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import type { FormulaFormatting, FormulaShowAs } from '../domain/table/fields/types/FormulaField';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { NumberDefaultValue } from '../domain/table/fields/types/NumberDefaultValue';
import {
  NumberFormatting,
  NumberFormattingType,
} from '../domain/table/fields/types/NumberFormatting';
import {
  MultiNumberDisplayType,
  NumberShowAs,
  SingleNumberDisplayType,
} from '../domain/table/fields/types/NumberShowAs';
import { RatingColor, ratingColorValues } from '../domain/table/fields/types/RatingColor';
import { RatingIcon, ratingIconValues } from '../domain/table/fields/types/RatingIcon';
import { RatingMax } from '../domain/table/fields/types/RatingMax';
import { SelectAutoNewOptions } from '../domain/table/fields/types/SelectAutoNewOptions';
import { SelectDefaultValue } from '../domain/table/fields/types/SelectDefaultValue';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import {
  SingleLineTextShowAs,
  singleLineTextShowAsValues,
} from '../domain/table/fields/types/SingleLineTextShowAs';
import { TextDefaultValue } from '../domain/table/fields/types/TextDefaultValue';
import { TIME_ZONE_LIST, TimeZone } from '../domain/table/fields/types/TimeZone';
import { UserDefaultValue } from '../domain/table/fields/types/UserDefaultValue';
import { UserMultiplicity } from '../domain/table/fields/types/UserMultiplicity';
import { UserNotification } from '../domain/table/fields/types/UserNotification';
import type { TableBuilder } from '../domain/table/TableBuilder';

const fieldColorSchema = z.enum(fieldColorValues);
const ratingIconSchema = z.enum(ratingIconValues);
const ratingColorSchema = z.enum(ratingColorValues);

const singleLineTextShowAsSchema = z.object({
  type: z.enum(singleLineTextShowAsValues),
});

const numberFormattingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(NumberFormattingType.Decimal),
    precision: z.number().min(0).max(5),
  }),
  z.object({
    type: z.literal(NumberFormattingType.Percent),
    precision: z.number().min(0).max(5),
  }),
  z.object({
    type: z.literal(NumberFormattingType.Currency),
    precision: z.number().min(0).max(5),
    symbol: z.string(),
  }),
]);

const singleNumberShowAsSchema = z.object({
  type: z.enum([SingleNumberDisplayType.Bar, SingleNumberDisplayType.Ring]),
  color: fieldColorSchema,
  showValue: z.boolean(),
  maxValue: z.number(),
});

const multiNumberShowAsSchema = z.object({
  type: z.enum([MultiNumberDisplayType.Bar, MultiNumberDisplayType.Line]),
  color: fieldColorSchema,
});

const numberShowAsSchema = z.union([singleNumberShowAsSchema, multiNumberShowAsSchema]);

const singleLineTextOptionsSchema = z.object({
  showAs: singleLineTextShowAsSchema.optional(),
  defaultValue: z.string().optional(),
});

const longTextOptionsSchema = z.object({
  defaultValue: z.string().optional(),
});

const numberOptionsSchema = z.object({
  formatting: numberFormattingSchema.optional(),
  showAs: numberShowAsSchema.optional(),
  defaultValue: z.number().optional(),
});

const ratingOptionsSchema = z.object({
  icon: ratingIconSchema.optional(),
  color: ratingColorSchema.optional(),
  max: z.number().optional(),
});

const selectChoiceSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  color: fieldColorSchema,
});

const selectOptionsSchema = z.object({
  choices: z.array(selectChoiceSchema).optional(),
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
  formatting: dateFormattingSchema.optional(),
  defaultValue: z.enum(['now']).optional(),
});

const userOptionsSchema = z.object({
  isMultiple: z.boolean().optional(),
  shouldNotify: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
});

const buttonWorkflowSchema = z.object({
  id: z.string().startsWith('wfl').optional(),
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

const formulaFormattingSchema = z.union([numberFormattingSchema, dateFormattingSchema]);

const formulaShowAsSchema = z.union([singleLineTextShowAsSchema, numberShowAsSchema]);
// Rehydration-only fields must never be accepted from create input.
const rehydratedOnlySchema = z.never().optional();

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
  fkHostTableName: rehydratedOnlySchema,
  selfKeyName: rehydratedOnlySchema,
  foreignKeyName: rehydratedOnlySchema,
  symmetricFieldId: z.string().optional(),
  filterByViewId: z.string().nullable().optional(),
  visibleFieldIds: z.array(z.string()).nullable().optional(),
});

export const tableFieldInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('singleLineText'),
    id: z.string().optional(),
    name: z.string(),
    options: singleLineTextOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('longText'),
    id: z.string().optional(),
    name: z.string(),
    options: longTextOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('number'),
    id: z.string().optional(),
    name: z.string(),
    options: numberOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('rating'),
    id: z.string().optional(),
    name: z.string(),
    max: z.number().optional(),
    options: ratingOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('singleSelect'),
    id: z.string().optional(),
    name: z.string(),
    options: z.union([z.array(z.string()), selectOptionsSchema]).optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('multipleSelect'),
    id: z.string().optional(),
    name: z.string(),
    options: z.union([z.array(z.string()), selectOptionsSchema]).optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('checkbox'),
    id: z.string().optional(),
    name: z.string(),
    options: checkboxOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('attachment'),
    id: z.string().optional(),
    name: z.string(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('date'),
    id: z.string().optional(),
    name: z.string(),
    options: dateOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('user'),
    id: z.string().optional(),
    name: z.string(),
    options: userOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('button'),
    id: z.string().optional(),
    name: z.string(),
    options: buttonOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('formula'),
    id: z.string().optional(),
    name: z.string(),
    options: formulaOptionsSchema,
    cellValueType: rehydratedOnlySchema,
    isMultipleCellValue: rehydratedOnlySchema,
    isPrimary: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('link'),
    id: z.string().optional(),
    name: z.string(),
    options: linkOptionsSchema,
    meta: rehydratedOnlySchema,
    isPrimary: z.boolean().optional(),
  }),
]);

export type ITableFieldInput = z.output<typeof tableFieldInputSchema>;

export interface ICreateTableFieldSpec {
  applyTo(builder: TableBuilder): void;
  createField(params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string>;
}

class CreateSingleLineTextFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly showAs: SingleLineTextShowAs | undefined,
    private readonly defaultValue: TextDefaultValue | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      showAs?: SingleLineTextShowAs;
      defaultValue?: TextDefaultValue;
    }
  ): CreateSingleLineTextFieldSpec {
    return new CreateSingleLineTextFieldSpec(
      id,
      name,
      options.showAs,
      options.defaultValue
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().singleLineText().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.showAs) fieldBuilder.withShowAs(this.showAs);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createSingleLineTextField({
        id,
        name: this.name,
        showAs: this.showAs,
        defaultValue: this.defaultValue,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateSingleLineTextFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateLongTextFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly defaultValue: TextDefaultValue | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean; defaultValue?: TextDefaultValue }
  ): CreateLongTextFieldSpec {
    return new CreateLongTextFieldSpec(id, name, options.defaultValue).withPrimary(
      options.isPrimary
    );
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().longText().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createLongTextField({ id, name: this.name, defaultValue: this.defaultValue })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateLongTextFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateNumberFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly formatting: NumberFormatting | undefined,
    private readonly showAs: NumberShowAs | undefined,
    private readonly defaultValue: NumberDefaultValue | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      formatting?: NumberFormatting;
      showAs?: NumberShowAs;
      defaultValue?: NumberDefaultValue;
    }
  ): CreateNumberFieldSpec {
    return new CreateNumberFieldSpec(
      id,
      name,
      options.formatting,
      options.showAs,
      options.defaultValue
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().number().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.showAs) fieldBuilder.withShowAs(this.showAs);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createNumberField({
        id,
        name: this.name,
        formatting: this.formatting,
        showAs: this.showAs,
        defaultValue: this.defaultValue,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateNumberFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateRatingFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly max: RatingMax | undefined,
    private readonly icon: RatingIcon | undefined,
    private readonly color: RatingColor | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      max?: RatingMax;
      icon?: RatingIcon;
      color?: RatingColor;
    }
  ): CreateRatingFieldSpec {
    return new CreateRatingFieldSpec(
      id,
      name,
      options.max,
      options.icon,
      options.color
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().rating().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.max) fieldBuilder.withMax(this.max);
    if (this.icon) fieldBuilder.withIcon(this.icon);
    if (this.color) fieldBuilder.withColor(this.color);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createRatingField({
        id,
        name: this.name,
        max: this.max,
        icon: this.icon,
        color: this.color,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateRatingFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateFormulaFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly expression: FormulaExpression,
    private readonly timeZone: TimeZone | undefined,
    private readonly formatting: FormulaFormatting | undefined,
    private readonly showAs: FormulaShowAs | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      expression: FormulaExpression;
      timeZone?: TimeZone;
      formatting?: FormulaFormatting;
      showAs?: FormulaShowAs;
    }
  ): CreateFormulaFieldSpec {
    return new CreateFormulaFieldSpec(
      id,
      name,
      options.expression,
      options.timeZone,
      options.formatting,
      options.showAs
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .formula()
      .withName(this.name)
      .withExpression(this.expression);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.timeZone) fieldBuilder.withTimeZone(this.timeZone);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.showAs) fieldBuilder.withShowAs(this.showAs);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createFormulaField({
        id,
        name: this.name,
        expression: this.expression,
        timeZone: this.timeZone,
        formatting: this.formatting,
        showAs: this.showAs,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateFormulaFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateLinkFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly config: LinkFieldConfig
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean; config: LinkFieldConfig }
  ): CreateLinkFieldSpec {
    return new CreateLinkFieldSpec(id, name, options.config).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().link().withName(this.name).withConfig(this.config);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    const baseId = params?.baseId;
    const tableId = params?.tableId;
    if (!baseId || !tableId) return err('CreateLinkFieldSpec requires table context');
    return resolveFieldId(this.id).andThen((id) =>
      createNewLinkField({ id, name: this.name, config: this.config, baseId, hostTableId: tableId })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateLinkFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateSingleSelectFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly options: ReadonlyArray<SelectOption>,
    private readonly defaultValue: SelectDefaultValue | undefined,
    private readonly preventAutoNewOptions: SelectAutoNewOptions | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: ReadonlyArray<SelectOption>,
    meta: {
      isPrimary: boolean;
      defaultValue?: SelectDefaultValue;
      preventAutoNewOptions?: SelectAutoNewOptions;
    }
  ): CreateSingleSelectFieldSpec {
    return new CreateSingleSelectFieldSpec(
      id,
      name,
      options,
      meta.defaultValue,
      meta.preventAutoNewOptions
    ).withPrimary(meta.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .singleSelect()
      .withName(this.name)
      .withOptions(this.options);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.preventAutoNewOptions) {
      fieldBuilder.withPreventAutoNewOptions(this.preventAutoNewOptions);
    }
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createSingleSelectField({
        id,
        name: this.name,
        options: this.options,
        defaultValue: this.defaultValue,
        preventAutoNewOptions: this.preventAutoNewOptions,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateSingleSelectFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateMultipleSelectFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly options: ReadonlyArray<SelectOption>,
    private readonly defaultValue: SelectDefaultValue | undefined,
    private readonly preventAutoNewOptions: SelectAutoNewOptions | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: ReadonlyArray<SelectOption>,
    meta: {
      isPrimary: boolean;
      defaultValue?: SelectDefaultValue;
      preventAutoNewOptions?: SelectAutoNewOptions;
    }
  ): CreateMultipleSelectFieldSpec {
    return new CreateMultipleSelectFieldSpec(
      id,
      name,
      options,
      meta.defaultValue,
      meta.preventAutoNewOptions
    ).withPrimary(meta.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .multipleSelect()
      .withName(this.name)
      .withOptions(this.options);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.preventAutoNewOptions) {
      fieldBuilder.withPreventAutoNewOptions(this.preventAutoNewOptions);
    }
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createMultipleSelectField({
        id,
        name: this.name,
        options: this.options,
        defaultValue: this.defaultValue,
        preventAutoNewOptions: this.preventAutoNewOptions,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateMultipleSelectFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateCheckboxFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly defaultValue: CheckboxDefaultValue | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean; defaultValue?: CheckboxDefaultValue }
  ): CreateCheckboxFieldSpec {
    return new CreateCheckboxFieldSpec(id, name, options.defaultValue).withPrimary(
      options.isPrimary
    );
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().checkbox().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createCheckboxField({ id, name: this.name, defaultValue: this.defaultValue })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateCheckboxFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateAttachmentFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean }
  ): CreateAttachmentFieldSpec {
    return new CreateAttachmentFieldSpec(id, name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().attachment().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) => createAttachmentField({ id, name: this.name }));
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateAttachmentFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateDateFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly formatting: DateTimeFormatting | undefined,
    private readonly defaultValue: DateDefaultValue | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      formatting?: DateTimeFormatting;
      defaultValue?: DateDefaultValue;
    }
  ): CreateDateFieldSpec {
    return new CreateDateFieldSpec(id, name, options.formatting, options.defaultValue).withPrimary(
      options.isPrimary
    );
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().date().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createDateField({
        id,
        name: this.name,
        formatting: this.formatting,
        defaultValue: this.defaultValue,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateDateFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateUserFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly multiplicity: UserMultiplicity | undefined,
    private readonly notification: UserNotification | undefined,
    private readonly defaultValue: UserDefaultValue | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      isMultiple?: UserMultiplicity;
      shouldNotify?: UserNotification;
      defaultValue?: UserDefaultValue;
    }
  ): CreateUserFieldSpec {
    return new CreateUserFieldSpec(
      id,
      name,
      options.isMultiple,
      options.shouldNotify,
      options.defaultValue
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().user().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.multiplicity) fieldBuilder.withMultiplicity(this.multiplicity);
    if (this.notification) fieldBuilder.withNotification(this.notification);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createUserField({
        id,
        name: this.name,
        isMultiple: this.multiplicity,
        shouldNotify: this.notification,
        defaultValue: this.defaultValue,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateUserFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateButtonFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly label: ButtonLabel | undefined,
    private readonly color: FieldColor | undefined,
    private readonly maxCount: ButtonMaxCount | undefined,
    private readonly resetCount: ButtonResetCount | undefined,
    private readonly workflow: ButtonWorkflow | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      label?: ButtonLabel;
      color?: FieldColor;
      maxCount?: ButtonMaxCount;
      resetCount?: ButtonResetCount;
      workflow?: ButtonWorkflow;
    }
  ): CreateButtonFieldSpec {
    return new CreateButtonFieldSpec(
      id,
      name,
      options.label,
      options.color,
      options.maxCount,
      options.resetCount,
      options.workflow
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().button().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.label) fieldBuilder.withLabel(this.label);
    if (this.color) fieldBuilder.withColor(this.color);
    if (this.maxCount) fieldBuilder.withMaxCount(this.maxCount);
    if (this.resetCount) fieldBuilder.withResetCount(this.resetCount);
    if (this.workflow) fieldBuilder.withWorkflow(this.workflow);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, string> {
    if (this.isPrimary) return err('Primary field updates are not supported');
    return resolveFieldId(this.id).andThen((id) =>
      createButtonField({
        id,
        name: this.name,
        label: this.label,
        color: this.color,
        maxCount: this.maxCount,
        resetCount: this.resetCount,
        workflow: this.workflow,
      })
    );
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateButtonFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

const sequence = <T>(values: ReadonlyArray<Result<T, string>>): Result<ReadonlyArray<T>, string> =>
  values.reduce<Result<ReadonlyArray<T>, string>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );

const optional = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, string>
): Result<T | undefined, string> => {
  if (raw == null) return ok(undefined);
  return parser(raw).map((value) => value);
};

type ParsedSelectOptions = {
  options: ReadonlyArray<SelectOption>;
  defaultValue?: SelectDefaultValue;
  preventAutoNewOptions?: SelectAutoNewOptions;
};

const parseSelectOptions = (raw: unknown): Result<ParsedSelectOptions, string> => {
  if (raw == null) return ok({ options: [] });

  if (Array.isArray(raw)) {
    const optionsResult = sequence(
      raw.map((name, index) =>
        SelectOption.create({
          name,
          color: fieldColorValues[index % fieldColorValues.length],
        })
      )
    );
    return optionsResult.map((options) => ({ options }));
  }

  const rawOptions = raw as {
    choices?: unknown;
    defaultValue?: unknown;
    preventAutoNewOptions?: unknown;
  };
  const rawChoices = Array.isArray(rawOptions.choices) ? rawOptions.choices : [];

  return sequence(rawChoices.map((choice) => SelectOption.create(choice))).andThen((options) =>
    optional(rawOptions.defaultValue, SelectDefaultValue.create).andThen((defaultValue) =>
      optional(rawOptions.preventAutoNewOptions, SelectAutoNewOptions.create).map(
        (preventAutoNewOptions) => ({
          options,
          defaultValue,
          preventAutoNewOptions,
        })
      )
    )
  );
};

const parseFormulaFormatting = (raw: unknown): Result<FormulaFormatting | undefined, string> => {
  if (raw == null) return ok(undefined);
  const numberResult = NumberFormatting.create(raw);
  if (numberResult.isOk()) return ok(numberResult.value);
  const dateResult = DateTimeFormatting.create(raw);
  if (dateResult.isOk()) return ok(dateResult.value);
  return err('Invalid FormulaFormatting');
};

const parseFormulaShowAs = (raw: unknown): Result<FormulaShowAs | undefined, string> => {
  if (raw == null) return ok(undefined);
  const numberResult = NumberShowAs.create(raw);
  if (numberResult.isOk()) return ok(numberResult.value);
  const textResult = SingleLineTextShowAs.create(raw);
  if (textResult.isOk()) return ok(textResult.value);
  return err('Invalid FormulaShowAs');
};

const resolveFieldId = (id?: FieldId): Result<FieldId, string> =>
  id ? ok(id) : FieldId.generate();

export const parseTableFieldSpec = (
  field: ITableFieldInput,
  options: { isPrimary: boolean }
): Result<ICreateTableFieldSpec, string> => {
  return optional(field.id, FieldId.create).andThen((id) =>
    FieldName.create(field.name).andThen((name) => {
      return match(field)
        .with({ type: 'singleLineText' }, (field) =>
          optional(field.options?.showAs, SingleLineTextShowAs.create).andThen((showAs) =>
            optional(field.options?.defaultValue, TextDefaultValue.create).map((defaultValue) =>
              CreateSingleLineTextFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                showAs,
                defaultValue,
              })
            )
          )
        )
        .with({ type: 'longText' }, (field) =>
          optional(field.options?.defaultValue, TextDefaultValue.create).map((defaultValue) =>
            CreateLongTextFieldSpec.create(id, name, { isPrimary: options.isPrimary, defaultValue })
          )
        )
        .with({ type: 'number' }, (field) =>
          optional(field.options?.formatting, NumberFormatting.create).andThen((formatting) =>
            optional(field.options?.showAs, NumberShowAs.create).andThen((showAs) =>
              optional(field.options?.defaultValue, NumberDefaultValue.create).map((defaultValue) =>
                CreateNumberFieldSpec.create(id, name, {
                  isPrimary: options.isPrimary,
                  formatting,
                  showAs,
                  defaultValue,
                })
              )
            )
          )
        )
        .with({ type: 'rating' }, (field) => {
          const maxRaw = field.options?.max ?? field.max;
          return optional(maxRaw, RatingMax.create).andThen((max) =>
            optional(field.options?.icon, RatingIcon.create).andThen((icon) =>
              optional(field.options?.color, RatingColor.create).map((color) =>
                CreateRatingFieldSpec.create(id, name, {
                  isPrimary: options.isPrimary,
                  max,
                  icon,
                  color,
                })
              )
            )
          );
        })
        .with({ type: 'formula' }, (field) =>
          FormulaExpression.create(field.options.expression).andThen((expression) =>
            optional(field.options.timeZone, TimeZone.create).andThen((timeZone) =>
              parseFormulaFormatting(field.options.formatting).andThen((formatting) =>
                parseFormulaShowAs(field.options.showAs).map((showAs) =>
                  CreateFormulaFieldSpec.create(id, name, {
                    isPrimary: options.isPrimary,
                    expression,
                    timeZone,
                    formatting,
                    showAs,
                  })
                )
              )
            )
          )
        )
        .with({ type: 'link' }, (field) =>
          LinkFieldConfig.create(field.options).map((config) =>
            CreateLinkFieldSpec.create(id, name, {
              isPrimary: options.isPrimary,
              config,
            })
          )
        )
        .with({ type: 'singleSelect' }, (field) =>
          parseSelectOptions(field.options).map(
            ({ options: selectOptions, defaultValue, preventAutoNewOptions }) =>
              CreateSingleSelectFieldSpec.create(id, name, selectOptions, {
                isPrimary: options.isPrimary,
                defaultValue,
                preventAutoNewOptions,
              })
          )
        )
        .with({ type: 'multipleSelect' }, (field) =>
          parseSelectOptions(field.options).map(
            ({ options: selectOptions, defaultValue, preventAutoNewOptions }) =>
              CreateMultipleSelectFieldSpec.create(id, name, selectOptions, {
                isPrimary: options.isPrimary,
                defaultValue,
                preventAutoNewOptions,
              })
          )
        )
        .with({ type: 'checkbox' }, (field) =>
          optional(field.options?.defaultValue, CheckboxDefaultValue.create).map((defaultValue) =>
            CreateCheckboxFieldSpec.create(id, name, {
              isPrimary: options.isPrimary,
              defaultValue,
            })
          )
        )
        .with({ type: 'attachment' }, () =>
          ok(CreateAttachmentFieldSpec.create(id, name, { isPrimary: options.isPrimary }))
        )
        .with({ type: 'date' }, (field) =>
          optional(field.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
            optional(field.options?.defaultValue, DateDefaultValue.create).map((defaultValue) =>
              CreateDateFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                formatting,
                defaultValue,
              })
            )
          )
        )
        .with({ type: 'user' }, (field) =>
          optional(field.options?.isMultiple, UserMultiplicity.create).andThen((isMultiple) =>
            optional(field.options?.shouldNotify, UserNotification.create).andThen((shouldNotify) =>
              optional(field.options?.defaultValue, UserDefaultValue.create).map((defaultValue) =>
                CreateUserFieldSpec.create(id, name, {
                  isPrimary: options.isPrimary,
                  isMultiple,
                  shouldNotify,
                  defaultValue,
                })
              )
            )
          )
        )
        .with({ type: 'button' }, (field) =>
          optional(field.options?.label, ButtonLabel.create).andThen((label) =>
            optional(field.options?.color, FieldColor.create).andThen((color) =>
              optional(field.options?.maxCount, ButtonMaxCount.create).andThen((maxCount) =>
                optional(field.options?.resetCount, ButtonResetCount.create).andThen((resetCount) =>
                  optional(field.options?.workflow, ButtonWorkflow.create).map((workflow) =>
                    CreateButtonFieldSpec.create(id, name, {
                      isPrimary: options.isPrimary,
                      label,
                      color,
                      maxCount,
                      resetCount,
                      workflow,
                    })
                  )
                )
              )
            )
          )
        )
        .exhaustive();
    })
  );
};
