import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
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
import { TableName } from '../domain/table/TableName';
import { ViewName } from '../domain/table/views/ViewName';

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

const formulaResultTypeSchema = z.enum(['string', 'number', 'boolean', 'dateTime']);

const formulaOptionsSchema = z.object({
  expression: z.string(),
  timeZone: z.enum(TIME_ZONE_LIST).optional(),
  formatting: formulaFormattingSchema.optional(),
  showAs: formulaShowAsSchema.optional(),
});

export const createTableInputSchema = z.object({
  baseId: z.string(),
  name: z.string(),
  fields: z
    .array(
      z.discriminatedUnion('type', [
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
          cellValueType: formulaResultTypeSchema.optional(),
          isMultipleCellValue: z.boolean().optional(),
          isPrimary: z.boolean().optional(),
        }),
      ])
    )
    .default([]),
  views: z
    .array(
      z.object({
        type: z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']).optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
});

export type ICreateTableCommandInput = z.input<typeof createTableInputSchema>;

export interface ICreateTableFieldSpec {
  applyTo(builder: TableBuilder): void;
}

export interface ICreateTableViewSpec {
  applyTo(builder: TableBuilder): void;
}

class CreateGridViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateGridViewSpec {
    return new CreateGridViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().grid().withName(this.name).done();
  }
}

class CreateKanbanViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateKanbanViewSpec {
    return new CreateKanbanViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().kanban().withName(this.name).done();
  }
}

class CreateGalleryViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateGalleryViewSpec {
    return new CreateGalleryViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().gallery().withName(this.name).done();
  }
}

class CreateCalendarViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateCalendarViewSpec {
    return new CreateCalendarViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().calendar().withName(this.name).done();
  }
}

class CreateFormViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateFormViewSpec {
    return new CreateFormViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().form().withName(this.name).done();
  }
}

class CreatePluginViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreatePluginViewSpec {
    return new CreatePluginViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().plugin().withName(this.name).done();
  }
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

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateFormulaFieldSpec {
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

export class CreateTableCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableName: TableName,
    readonly fields: ReadonlyArray<ICreateTableFieldSpec>,
    readonly views: ReadonlyArray<ICreateTableViewSpec>
  ) {}

  static create(raw: unknown): Result<CreateTableCommand, string> {
    const parsed = createTableInputSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid CreateTableCommand input');

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableName.create(parsed.data.name).andThen((tableName) =>
        this.parseFields(parsed.data.fields)
          .andThen((fields) =>
            this.parseViews(parsed.data.views).map((views) => ({ fields, views }))
          )
          .map(({ fields, views }) => new CreateTableCommand(baseId, tableName, fields, views))
      )
    );
  }

  private static parseFields(
    rawFields: ReadonlyArray<z.output<typeof createTableInputSchema>['fields'][number]>
  ): Result<ReadonlyArray<ICreateTableFieldSpec>, string> {
    const fieldsToUse =
      rawFields.length > 0
        ? rawFields
        : [{ type: 'singleLineText' as const, name: 'Name', isPrimary: true }];

    const primaryIndexes = fieldsToUse
      .map((f, i) => ({ isPrimary: f.isPrimary === true, i }))
      .filter((x) => x.isPrimary)
      .map((x) => x.i);

    if (primaryIndexes.length > 1)
      return err('CreateTableCommand requires exactly one primary Field');

    const primaryIndex = primaryIndexes[0] ?? 0;

    const specs = fieldsToUse.map((field, index) => {
      const isPrimary = index === primaryIndex;
      return optional(field.id, FieldId.create).andThen((id) =>
        FieldName.create(field.name).andThen((name) => {
          return match(field)
            .with({ type: 'singleLineText' }, (field) =>
              optional(field.options?.showAs, SingleLineTextShowAs.create).andThen((showAs) =>
                optional(field.options?.defaultValue, TextDefaultValue.create).map((defaultValue) =>
                  CreateSingleLineTextFieldSpec.create(id, name, {
                    isPrimary,
                    showAs,
                    defaultValue,
                  })
                )
              )
            )
            .with({ type: 'longText' }, (field) =>
              optional(field.options?.defaultValue, TextDefaultValue.create).map((defaultValue) =>
                CreateLongTextFieldSpec.create(id, name, { isPrimary, defaultValue })
              )
            )
            .with({ type: 'number' }, (field) =>
              optional(field.options?.formatting, NumberFormatting.create).andThen((formatting) =>
                optional(field.options?.showAs, NumberShowAs.create).andThen((showAs) =>
                  optional(field.options?.defaultValue, NumberDefaultValue.create).map(
                    (defaultValue) =>
                      CreateNumberFieldSpec.create(id, name, {
                        isPrimary,
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
                    CreateRatingFieldSpec.create(id, name, { isPrimary, max, icon, color })
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
                        isPrimary,
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
            .with({ type: 'singleSelect' }, (field) =>
              parseSelectOptions(field.options).map(
                ({ options, defaultValue, preventAutoNewOptions }) =>
                  CreateSingleSelectFieldSpec.create(id, name, options, {
                    isPrimary,
                    defaultValue,
                    preventAutoNewOptions,
                  })
              )
            )
            .with({ type: 'multipleSelect' }, (field) =>
              parseSelectOptions(field.options).map(
                ({ options, defaultValue, preventAutoNewOptions }) =>
                  CreateMultipleSelectFieldSpec.create(id, name, options, {
                    isPrimary,
                    defaultValue,
                    preventAutoNewOptions,
                  })
              )
            )
            .with({ type: 'checkbox' }, (field) =>
              optional(field.options?.defaultValue, CheckboxDefaultValue.create).map(
                (defaultValue) =>
                  CreateCheckboxFieldSpec.create(id, name, { isPrimary, defaultValue })
              )
            )
            .with({ type: 'attachment' }, () =>
              ok(CreateAttachmentFieldSpec.create(id, name, { isPrimary }))
            )
            .with({ type: 'date' }, (field) =>
              optional(field.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
                optional(field.options?.defaultValue, DateDefaultValue.create).map((defaultValue) =>
                  CreateDateFieldSpec.create(id, name, { isPrimary, formatting, defaultValue })
                )
              )
            )
            .with({ type: 'user' }, (field) =>
              optional(field.options?.isMultiple, UserMultiplicity.create).andThen((isMultiple) =>
                optional(field.options?.shouldNotify, UserNotification.create).andThen(
                  (shouldNotify) =>
                    optional(field.options?.defaultValue, UserDefaultValue.create).map(
                      (defaultValue) =>
                        CreateUserFieldSpec.create(id, name, {
                          isPrimary,
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
                    optional(field.options?.resetCount, ButtonResetCount.create).andThen(
                      (resetCount) =>
                        optional(field.options?.workflow, ButtonWorkflow.create).map((workflow) =>
                          CreateButtonFieldSpec.create(id, name, {
                            isPrimary,
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
    });

    return sequence(specs);
  }

  private static parseViews(
    rawViews: z.output<typeof createTableInputSchema>['views']
  ): Result<ReadonlyArray<ICreateTableViewSpec>, string> {
    const viewsToUse =
      rawViews && rawViews.length > 0 ? rawViews : [{ type: 'grid' as const, name: 'Grid' }];

    const defaultViewNameByType = (type: string): string =>
      match(type)
        .with('calendar', () => 'Calendar')
        .with('kanban', () => 'Kanban')
        .with('form', () => 'Form')
        .with('gallery', () => 'Gallery')
        .with('plugin', () => 'Plugin')
        .otherwise(() => 'Grid');

    const specs = viewsToUse.map((view) => {
      const type = view.type ?? 'grid';
      const rawName = view.name ?? defaultViewNameByType(type);

      return ViewName.create(rawName).andThen((name) => {
        return match(type)
          .with('grid', () => ok(CreateGridViewSpec.create(name)))
          .with('kanban', () => ok(CreateKanbanViewSpec.create(name)))
          .with('gallery', () => ok(CreateGalleryViewSpec.create(name)))
          .with('calendar', () => ok(CreateCalendarViewSpec.create(name)))
          .with('form', () => ok(CreateFormViewSpec.create(name)))
          .with('plugin', () => ok(CreatePluginViewSpec.create(name)))
          .otherwise(() => err('Unsupported view type'));
      });
    });

    return sequence(specs);
  }
}
