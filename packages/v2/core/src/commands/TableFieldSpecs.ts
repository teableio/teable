import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { z } from 'zod';

import type { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { Field } from '../domain/table/fields/Field';
import {
  createAttachmentField,
  createAutoNumberField,
  createButtonField,
  createCheckboxField,
  createConditionalLookupFieldPending,
  createConditionalRollupFieldPending,
  createCreatedByField,
  createCreatedTimeField,
  createDateField,
  createFormulaField,
  createLastModifiedByField,
  createLastModifiedTimeField,
  createLookupFieldPending,
  createRollupFieldPending,
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
import { ButtonLabel } from '../domain/table/fields/types/ButtonLabel';
import { ButtonMaxCount } from '../domain/table/fields/types/ButtonMaxCount';
import { ButtonResetCount } from '../domain/table/fields/types/ButtonResetCount';
import { ButtonWorkflow } from '../domain/table/fields/types/ButtonWorkflow';
import { CheckboxDefaultValue } from '../domain/table/fields/types/CheckboxDefaultValue';
import { ConditionalLookupOptions } from '../domain/table/fields/types/ConditionalLookupOptions';
import { ConditionalRollupConfig } from '../domain/table/fields/types/ConditionalRollupConfig';
import { DateDefaultValue } from '../domain/table/fields/types/DateDefaultValue';
import {
  DateTimeFormatting,
  TimeFormatting,
} from '../domain/table/fields/types/DateTimeFormatting';
import { FieldColor, fieldColorValues } from '../domain/table/fields/types/FieldColor';
import { FieldNotNull } from '../domain/table/fields/types/FieldNotNull';
import { FieldUnique } from '../domain/table/fields/types/FieldUnique';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import type { FormulaFormatting, FormulaShowAs } from '../domain/table/fields/types/FormulaField';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { LookupOptions } from '../domain/table/fields/types/LookupOptions';
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
import { RollupExpression } from '../domain/table/fields/types/RollupExpression';
import { RollupFieldConfig } from '../domain/table/fields/types/RollupFieldConfig';
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
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { TableBuilder } from '../domain/table/TableBuilder';
import { TableId } from '../domain/table/TableId';
import {
  checkFieldNotNullValidationEnabled,
  checkFieldUniqueValidationEnabled,
  isComputedFieldType,
} from './FieldValidation';

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

const trackedFieldIdsSchema = z.array(z.string());

const createdTimeOptionsSchema = z.object({
  formatting: dateFormattingSchema.optional(),
});

const lastModifiedTimeOptionsSchema = z.object({
  formatting: dateFormattingSchema.optional(),
  trackedFieldIds: trackedFieldIdsSchema.optional(),
});

const createdByOptionsSchema = z.object({});

const lastModifiedByOptionsSchema = z.object({
  trackedFieldIds: trackedFieldIdsSchema.optional(),
});

const autoNumberOptionsSchema = z.object({});

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

const formulaOptionsSchema = z.object({
  expression: z.string(),
  timeZone: z.enum(TIME_ZONE_LIST).optional(),
  formatting: formulaFormattingSchema.optional(),
  showAs: formulaShowAsSchema.optional(),
});

const linkRelationshipSchema = z.enum(['oneOne', 'manyMany', 'oneMany', 'manyOne']);

const linkOptionsSchema = z
  .object({
    baseId: z.string().optional(),
    relationship: linkRelationshipSchema,
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    isOneWay: z.boolean().optional(),
    symmetricFieldId: z.string().optional(),
    filterByViewId: z.string().nullable().optional(),
    visibleFieldIds: z.array(z.string()).nullable().optional(),
  })
  .strict();

const rollupOptionsSchema = z
  .object({
    expression: z.string(),
    timeZone: z.enum(TIME_ZONE_LIST).optional(),
    formatting: formulaFormattingSchema.optional(),
    showAs: formulaShowAsSchema.optional(),
  })
  .strict();

const rollupConfigSchema = z
  .object({
    linkFieldId: z.string(),
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
  })
  .strict();

const lookupOptionsSchema = z
  .object({
    linkFieldId: z.string(),
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
  })
  .strict();

const filterItemSchema = z.object({
  fieldId: z.string(),
  operator: z.string(),
  value: z.unknown(),
});

const filterSetSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    filterItemSchema,
    z.object({
      conjunction: z.enum(['and', 'or']),
      filterSet: z.array(filterSetSchema),
    }),
  ])
);

const fieldConditionSchema = z.object({
  filter: z
    .object({
      conjunction: z.enum(['and', 'or']),
      filterSet: z.array(filterSetSchema).optional(),
    })
    .nullable()
    .optional(),
  sort: z
    .object({
      fieldId: z.string(),
      order: z.enum(['asc', 'desc']),
    })
    .optional(),
  limit: z.number().optional(),
});

const conditionalRollupConfigSchema = z
  .object({
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    condition: fieldConditionSchema,
  })
  .strict()
  .refine(
    (data) => {
      // Condition must have at least one filter item
      const filter = data.condition?.filter;
      return (
        filter !== null &&
        filter !== undefined &&
        filter.filterSet !== undefined &&
        filter.filterSet.length > 0
      );
    },
    {
      message: 'ConditionalRollupConfig condition must have at least one filter item',
      path: ['condition'],
    }
  );

const conditionalRollupOptionsSchema = z
  .object({
    expression: z.string(),
    timeZone: z.enum(TIME_ZONE_LIST).optional(),
    formatting: formulaFormattingSchema.optional(),
    showAs: formulaShowAsSchema.optional(),
  })
  .strict();

const conditionalLookupOptionsSchema = z
  .object({
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    condition: fieldConditionSchema,
  })
  .strict()
  .refine(
    (data) => {
      // Condition must have at least one filter item
      const filter = data.condition?.filter;
      return (
        filter !== null &&
        filter !== undefined &&
        filter.filterSet !== undefined &&
        filter.filterSet.length > 0
      );
    },
    {
      message: 'ConditionalLookupOptions condition must have at least one filter item',
      path: ['condition'],
    }
  );

export const tableFieldInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('singleLineText'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: singleLineTextOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('longText'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: longTextOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('number'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: numberOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('rating'),
    id: z.string().optional(),
    name: z.string().optional(),
    max: z.number().optional(),
    options: ratingOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('singleSelect'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: z.union([z.array(z.string()), selectOptionsSchema]).optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('multipleSelect'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: z.union([z.array(z.string()), selectOptionsSchema]).optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('checkbox'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: checkboxOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('attachment'),
    id: z.string().optional(),
    name: z.string().optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('date'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: dateOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('createdTime'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: createdTimeOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('lastModifiedTime'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: lastModifiedTimeOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('user'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: userOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('createdBy'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: createdByOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('lastModifiedBy'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: lastModifiedByOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('autoNumber'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: autoNumberOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('button'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: buttonOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z
    .object({
      type: z.literal('formula'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: formulaOptionsSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('link'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: linkOptionsSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('rollup'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: rollupOptionsSchema,
      config: rollupConfigSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('lookup'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: lookupOptionsSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('conditionalRollup'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: conditionalRollupOptionsSchema,
      config: conditionalRollupConfigSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('conditionalLookup'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: conditionalLookupOptionsSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
]);

export type ITableFieldInput = z.output<typeof tableFieldInputSchema>;
export type ResolvedTableFieldInput = ITableFieldInput & { name: string };

const getUniqName = (name: string, existNames: ReadonlyArray<string>): string => {
  if (!existNames.includes(name)) return name;

  let baseName = name;
  let num = 2;

  if (Number.isNaN(Number(name))) {
    const match = name.match(/^(.*)(\b\d+)$/);
    if (match) {
      baseName = match[1]?.trim() ?? name;
      num = Number.parseInt(match[2] ?? `${num}`, 10);
    }
  }

  while (existNames.includes(`${baseName} ${num}`)) {
    num += 1;
  }

  return `${baseName} ${num}`;
};

const defaultFieldName = (field: ITableFieldInput): string => {
  if (field.isPrimary === true) return 'Name';
  switch (field.type) {
    case 'singleLineText':
      return 'Label';
    case 'longText':
      return 'Notes';
    case 'number':
      return 'Number';
    case 'rating':
      return 'Rating';
    case 'singleSelect':
      return 'Select';
    case 'multipleSelect':
      return 'Tags';
    case 'checkbox':
      return 'Done';
    case 'attachment':
      return 'Attachments';
    case 'date':
      return 'Date';
    case 'createdTime':
      return 'Created Time';
    case 'lastModifiedTime':
      return 'Last Modified Time';
    case 'user': {
      const isMultiple = Boolean(
        (field as { options?: { isMultiple?: boolean } }).options?.isMultiple
      );
      return isMultiple ? 'Collaborators' : 'Collaborator';
    }
    case 'createdBy':
      return 'Created By';
    case 'lastModifiedBy':
      return 'Last Modified By';
    case 'autoNumber':
      return 'Auto Number';
    case 'button':
      return 'Button';
    case 'formula':
      return 'Calculation';
    case 'rollup':
      return 'Rollup';
    case 'link':
      return 'Link';
    case 'lookup':
      return 'Lookup';
    case 'conditionalRollup':
      return 'Conditional Rollup';
    case 'conditionalLookup':
      return 'Conditional Lookup';
    default:
      return 'Field';
  }
};

export const resolveTableFieldInputName = (
  field: ITableFieldInput,
  existingNames: ReadonlyArray<string>
): Result<ResolvedTableFieldInput, DomainError> => {
  if (typeof field.name === 'string') {
    const trimmed = field.name.trim();
    if (trimmed.length > 0) {
      return FieldName.create(trimmed).map((name) => ({ ...field, name: name.toString() }));
    }
  }

  const baseName = defaultFieldName(field);
  const uniqueName = getUniqName(baseName, existingNames);
  return FieldName.create(uniqueName).map((name) => ({ ...field, name: name.toString() }));
};

export const resolveTableFieldInputs = (
  fields: ReadonlyArray<ITableFieldInput>,
  existingNames: ReadonlyArray<string>
): Result<ReadonlyArray<ResolvedTableFieldInput>, DomainError> => {
  const resolved: ResolvedTableFieldInput[] = [];
  const names = [...existingNames];

  for (const field of fields) {
    const nameResult = resolveTableFieldInputName(field, names);
    if (nameResult.isErr()) return err(nameResult.error);
    resolved.push(nameResult.value);
    names.push(nameResult.value.name);
  }

  return ok(resolved);
};

export interface ICreateTableFieldSpec {
  applyTo(builder: TableBuilder): void;
  createField(params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError>;
  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError>;
}

const uniqueForeignTableReferences = (
  refs: ReadonlyArray<LinkForeignTableReference>
): ReadonlyArray<LinkForeignTableReference> => {
  const unique: LinkForeignTableReference[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const baseKey = ref.baseId ? ref.baseId.toString() : 'local';
    const key = `${baseKey}:${ref.foreignTableId.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
};

export const collectForeignTableReferences = (
  specs: ReadonlyArray<ICreateTableFieldSpec>
): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> => {
  return specs
    .reduce<
      Result<ReadonlyArray<LinkForeignTableReference>, DomainError>
    >((acc, spec) => acc.andThen((refs) => spec.foreignTableReferences().map((next) => [...refs, ...next])), ok([]))
    .map((refs) => uniqueForeignTableReferences(refs));
};

class CreateSingleLineTextFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly showAs: SingleLineTextShowAs | undefined,
    private readonly defaultValue: TextDefaultValue | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      showAs?: SingleLineTextShowAs;
      defaultValue?: TextDefaultValue;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateSingleLineTextFieldSpec {
    return new CreateSingleLineTextFieldSpec(
      id,
      name,
      options.showAs,
      options.defaultValue,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .singleLineText()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.showAs) fieldBuilder.withShowAs(this.showAs);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createSingleLineTextField({
        id,
        name: this.name,
        showAs: this.showAs,
        defaultValue: this.defaultValue,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
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
    private readonly defaultValue: TextDefaultValue | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      defaultValue?: TextDefaultValue;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateLongTextFieldSpec {
    return new CreateLongTextFieldSpec(
      id,
      name,
      options.defaultValue,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .longText()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createLongTextField({
        id,
        name: this.name,
        defaultValue: this.defaultValue,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
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
    private readonly defaultValue: NumberDefaultValue | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      formatting?: NumberFormatting;
      showAs?: NumberShowAs;
      defaultValue?: NumberDefaultValue;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateNumberFieldSpec {
    return new CreateNumberFieldSpec(
      id,
      name,
      options.formatting,
      options.showAs,
      options.defaultValue,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .number()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.showAs) fieldBuilder.withShowAs(this.showAs);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createNumberField({
        id,
        name: this.name,
        formatting: this.formatting,
        showAs: this.showAs,
        defaultValue: this.defaultValue,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
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
    private readonly color: RatingColor | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      max?: RatingMax;
      icon?: RatingIcon;
      color?: RatingColor;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateRatingFieldSpec {
    return new CreateRatingFieldSpec(
      id,
      name,
      options.max,
      options.icon,
      options.color,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .rating()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.max) fieldBuilder.withMax(this.max);
    if (this.icon) fieldBuilder.withIcon(this.icon);
    if (this.color) fieldBuilder.withColor(this.color);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createRatingField({
        id,
        name: this.name,
        max: this.max,
        icon: this.icon,
        color: this.color,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
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

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
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

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateFormulaFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateRollupFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly config: RollupFieldConfig,
    private readonly expression: RollupExpression,
    private readonly timeZone: TimeZone | undefined,
    private readonly formatting: FormulaFormatting | undefined,
    private readonly showAs: FormulaShowAs | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      config: RollupFieldConfig;
      expression: RollupExpression;
      timeZone?: TimeZone;
      formatting?: FormulaFormatting;
      showAs?: FormulaShowAs;
    }
  ): CreateRollupFieldSpec {
    return new CreateRollupFieldSpec(
      id,
      name,
      options.config,
      options.expression,
      options.timeZone,
      options.formatting,
      options.showAs
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .rollup()
      .withName(this.name)
      .withConfig(this.config)
      .withExpression(this.expression);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.timeZone) fieldBuilder.withTimeZone(this.timeZone);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.showAs) fieldBuilder.withShowAs(this.showAs);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createRollupFieldPending({
        id,
        name: this.name,
        config: this.config,
        expression: this.expression,
        timeZone: this.timeZone,
        formatting: this.formatting,
        showAs: this.showAs,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([
      {
        foreignTableId: this.config.foreignTableId(),
      },
    ]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateRollupFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateLinkFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly config: LinkFieldConfig,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      config: LinkFieldConfig;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateLinkFieldSpec {
    return new CreateLinkFieldSpec(
      id,
      name,
      options.config,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .link()
      .withName(this.name)
      .withConfig(this.config)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    const baseId = params?.baseId;
    const tableId = params?.tableId;
    if (!baseId || !tableId)
      return err(domainError.unexpected({ message: 'CreateLinkFieldSpec requires table context' }));
    return resolveFieldId(this.id).andThen((id) =>
      createNewLinkField({
        id,
        name: this.name,
        config: this.config,
        baseId,
        hostTableId: tableId,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([
      {
        foreignTableId: this.config.foreignTableId(),
        baseId: this.config.baseId(),
      },
    ]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateLinkFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateLookupFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly linkFieldId: string,
    private readonly foreignTableId: string,
    private readonly lookupFieldId: string,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      linkFieldId: string;
      foreignTableId: string;
      lookupFieldId: string;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateLookupFieldSpec {
    return new CreateLookupFieldSpec(
      id,
      name,
      options.linkFieldId,
      options.foreignTableId,
      options.lookupFieldId,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    // Lookup fields are created as pending (without inner field resolved)
    // The inner field will be resolved during foreign table validation in the handler
    const fieldResult = this.createField();
    builder.addFieldFromResult(fieldResult);
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary) {
      return err(domainError.validation({ message: 'Primary field cannot be a lookup field' }));
    }
    return resolveFieldId(this.id).andThen((id) =>
      LookupOptions.create({
        linkFieldId: this.linkFieldId,
        foreignTableId: this.foreignTableId,
        lookupFieldId: this.lookupFieldId,
      }).andThen((lookupOptions) =>
        createLookupFieldPending({
          id,
          name: this.name,
          lookupOptions,
          notNull: this.notNull,
          unique: this.unique,
        })
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return TableId.create(this.foreignTableId).map((foreignTableId) => [
      {
        foreignTableId,
      },
    ]);
  }

  linkFieldIdValue(): string {
    return this.linkFieldId;
  }

  foreignTableIdValue(): string {
    return this.foreignTableId;
  }

  lookupFieldIdValue(): string {
    return this.lookupFieldId;
  }

  nameValue(): FieldName {
    return this.name;
  }

  idValue(): FieldId | undefined {
    return this.id;
  }

  notNullValue(): FieldNotNull {
    return this.notNull;
  }

  uniqueValue(): FieldUnique {
    return this.unique;
  }

  private isPrimary = false;

  isPrimaryValue(): boolean {
    return this.isPrimary;
  }

  private withPrimary(isPrimary: boolean): CreateLookupFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateConditionalRollupFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly config: ConditionalRollupConfig,
    private readonly expression: RollupExpression,
    private readonly timeZone: TimeZone | undefined,
    private readonly formatting: FormulaFormatting | undefined,
    private readonly showAs: FormulaShowAs | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      config: ConditionalRollupConfig;
      expression: RollupExpression;
      timeZone?: TimeZone;
      formatting?: FormulaFormatting;
      showAs?: FormulaShowAs;
    }
  ): CreateConditionalRollupFieldSpec {
    return new CreateConditionalRollupFieldSpec(
      id,
      name,
      options.config,
      options.expression,
      options.timeZone,
      options.formatting,
      options.showAs
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .conditionalRollup()
      .withName(this.name)
      .withConfig(this.config)
      .withExpression(this.expression);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.timeZone) fieldBuilder.withTimeZone(this.timeZone);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.showAs) fieldBuilder.withShowAs(this.showAs);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createConditionalRollupFieldPending({
        id,
        name: this.name,
        config: this.config,
        expression: this.expression,
        timeZone: this.timeZone,
        formatting: this.formatting,
        showAs: this.showAs,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([
      {
        foreignTableId: this.config.foreignTableId(),
      },
    ]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateConditionalRollupFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateConditionalLookupFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly conditionalLookupOptions: ConditionalLookupOptions
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      conditionalLookupOptions: ConditionalLookupOptions;
    }
  ): CreateConditionalLookupFieldSpec {
    return new CreateConditionalLookupFieldSpec(
      id,
      name,
      options.conditionalLookupOptions
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    // ConditionalLookup fields are created as pending (without inner field resolved)
    // The inner field will be resolved during foreign table validation in the handler
    const fieldResult = this.createField();
    builder.addFieldFromResult(fieldResult);
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary) {
      return err(
        domainError.validation({ message: 'Primary field cannot be a conditional lookup field' })
      );
    }
    return resolveFieldId(this.id).andThen((id) =>
      createConditionalLookupFieldPending({
        id,
        name: this.name,
        conditionalLookupOptions: this.conditionalLookupOptions,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([
      {
        foreignTableId: this.conditionalLookupOptions.foreignTableId(),
      },
    ]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateConditionalLookupFieldSpec {
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
    private readonly preventAutoNewOptions: SelectAutoNewOptions | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: ReadonlyArray<SelectOption>,
    meta: {
      isPrimary: boolean;
      defaultValue?: SelectDefaultValue;
      preventAutoNewOptions?: SelectAutoNewOptions;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateSingleSelectFieldSpec {
    return new CreateSingleSelectFieldSpec(
      id,
      name,
      options,
      meta.defaultValue,
      meta.preventAutoNewOptions,
      meta.notNull,
      meta.unique
    ).withPrimary(meta.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .singleSelect()
      .withName(this.name)
      .withOptions(this.options)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.preventAutoNewOptions) {
      fieldBuilder.withPreventAutoNewOptions(this.preventAutoNewOptions);
    }
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createSingleSelectField({
        id,
        name: this.name,
        options: this.options,
        defaultValue: this.defaultValue,
        preventAutoNewOptions: this.preventAutoNewOptions,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
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
    private readonly preventAutoNewOptions: SelectAutoNewOptions | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: ReadonlyArray<SelectOption>,
    meta: {
      isPrimary: boolean;
      defaultValue?: SelectDefaultValue;
      preventAutoNewOptions?: SelectAutoNewOptions;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateMultipleSelectFieldSpec {
    return new CreateMultipleSelectFieldSpec(
      id,
      name,
      options,
      meta.defaultValue,
      meta.preventAutoNewOptions,
      meta.notNull,
      meta.unique
    ).withPrimary(meta.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .multipleSelect()
      .withName(this.name)
      .withOptions(this.options)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.preventAutoNewOptions) {
      fieldBuilder.withPreventAutoNewOptions(this.preventAutoNewOptions);
    }
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createMultipleSelectField({
        id,
        name: this.name,
        options: this.options,
        defaultValue: this.defaultValue,
        preventAutoNewOptions: this.preventAutoNewOptions,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
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
    private readonly defaultValue: CheckboxDefaultValue | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      defaultValue?: CheckboxDefaultValue;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateCheckboxFieldSpec {
    return new CreateCheckboxFieldSpec(
      id,
      name,
      options.defaultValue,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .checkbox()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createCheckboxField({
        id,
        name: this.name,
        defaultValue: this.defaultValue,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
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
    private readonly name: FieldName,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean; notNull: FieldNotNull; unique: FieldUnique }
  ): CreateAttachmentFieldSpec {
    return new CreateAttachmentFieldSpec(id, name, options.notNull, options.unique).withPrimary(
      options.isPrimary
    );
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .attachment()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createAttachmentField({
        id,
        name: this.name,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
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
    private readonly defaultValue: DateDefaultValue | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      formatting?: DateTimeFormatting;
      defaultValue?: DateDefaultValue;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateDateFieldSpec {
    return new CreateDateFieldSpec(
      id,
      name,
      options.formatting,
      options.defaultValue,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .date()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createDateField({
        id,
        name: this.name,
        formatting: this.formatting,
        defaultValue: this.defaultValue,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateDateFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateCreatedTimeFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly formatting: DateTimeFormatting | undefined
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean; formatting?: DateTimeFormatting }
  ): CreateCreatedTimeFieldSpec {
    return new CreateCreatedTimeFieldSpec(id, name, options.formatting).withPrimary(
      options.isPrimary
    );
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().createdTime().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createCreatedTimeField({
        id,
        name: this.name,
        formatting: this.formatting,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateCreatedTimeFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateLastModifiedTimeFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly formatting: DateTimeFormatting | undefined,
    private readonly trackedFieldIds: ReadonlyArray<FieldId>
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      formatting?: DateTimeFormatting;
      trackedFieldIds: ReadonlyArray<FieldId>;
    }
  ): CreateLastModifiedTimeFieldSpec {
    return new CreateLastModifiedTimeFieldSpec(
      id,
      name,
      options.formatting,
      options.trackedFieldIds
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().lastModifiedTime().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.formatting) fieldBuilder.withFormatting(this.formatting);
    if (this.trackedFieldIds.length > 0) fieldBuilder.withTrackedFieldIds(this.trackedFieldIds);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createLastModifiedTimeField({
        id,
        name: this.name,
        formatting: this.formatting,
        trackedFieldIds: this.trackedFieldIds,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateLastModifiedTimeFieldSpec {
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
    private readonly defaultValue: UserDefaultValue | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: {
      isPrimary: boolean;
      isMultiple?: UserMultiplicity;
      shouldNotify?: UserNotification;
      defaultValue?: UserDefaultValue;
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateUserFieldSpec {
    return new CreateUserFieldSpec(
      id,
      name,
      options.isMultiple,
      options.shouldNotify,
      options.defaultValue,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .user()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.multiplicity) fieldBuilder.withMultiplicity(this.multiplicity);
    if (this.notification) fieldBuilder.withNotification(this.notification);
    if (this.defaultValue) fieldBuilder.withDefaultValue(this.defaultValue);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createUserField({
        id,
        name: this.name,
        isMultiple: this.multiplicity,
        shouldNotify: this.notification,
        defaultValue: this.defaultValue,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateUserFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateCreatedByFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean }
  ): CreateCreatedByFieldSpec {
    return new CreateCreatedByFieldSpec(id, name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().createdBy().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) => createCreatedByField({ id, name: this.name }));
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateCreatedByFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateLastModifiedByFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName,
    private readonly trackedFieldIds: ReadonlyArray<FieldId>
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean; trackedFieldIds: ReadonlyArray<FieldId> }
  ): CreateLastModifiedByFieldSpec {
    return new CreateLastModifiedByFieldSpec(id, name, options.trackedFieldIds).withPrimary(
      options.isPrimary
    );
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().lastModifiedBy().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.trackedFieldIds.length > 0) fieldBuilder.withTrackedFieldIds(this.trackedFieldIds);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createLastModifiedByField({
        id,
        name: this.name,
        trackedFieldIds: this.trackedFieldIds,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateLastModifiedByFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateAutoNumberFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly id: FieldId | undefined,
    private readonly name: FieldName
  ) {}

  static create(
    id: FieldId | undefined,
    name: FieldName,
    options: { isPrimary: boolean }
  ): CreateAutoNumberFieldSpec {
    return new CreateAutoNumberFieldSpec(id, name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().autoNumber().withName(this.name);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) => createAutoNumberField({ id, name: this.name }));
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateAutoNumberFieldSpec {
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
    private readonly workflow: ButtonWorkflow | undefined,
    private readonly notNull: FieldNotNull,
    private readonly unique: FieldUnique
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
      notNull: FieldNotNull;
      unique: FieldUnique;
    }
  ): CreateButtonFieldSpec {
    return new CreateButtonFieldSpec(
      id,
      name,
      options.label,
      options.color,
      options.maxCount,
      options.resetCount,
      options.workflow,
      options.notNull,
      options.unique
    ).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .button()
      .withName(this.name)
      .withNotNull(this.notNull)
      .withUnique(this.unique);
    if (this.id) fieldBuilder.withId(this.id);
    if (this.label) fieldBuilder.withLabel(this.label);
    if (this.color) fieldBuilder.withColor(this.color);
    if (this.maxCount) fieldBuilder.withMaxCount(this.maxCount);
    if (this.resetCount) fieldBuilder.withResetCount(this.resetCount);
    if (this.workflow) fieldBuilder.withWorkflow(this.workflow);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  createField(_params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    if (this.isPrimary)
      return err(domainError.validation({ message: 'Primary field updates are not supported' }));
    return resolveFieldId(this.id).andThen((id) =>
      createButtonField({
        id,
        name: this.name,
        label: this.label,
        color: this.color,
        maxCount: this.maxCount,
        resetCount: this.resetCount,
        workflow: this.workflow,
        notNull: this.notNull,
        unique: this.unique,
      })
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateButtonFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );

const optional = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, DomainError>
): Result<T | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  return parser(raw).map((value) => value);
};

type FieldValidationConfig = {
  notNull: FieldNotNull;
  unique: FieldUnique;
};

const parseFieldNotNull = (raw: unknown, enabled: boolean): Result<FieldNotNull, DomainError> => {
  if (!enabled) {
    if (raw === true)
      return err(
        domainError.validation({ message: 'Field notNull is not supported for this type' })
      );
    return ok(FieldNotNull.optional());
  }
  if (raw == null) return ok(FieldNotNull.optional());
  return FieldNotNull.create(raw);
};

const parseFieldUnique = (raw: unknown, enabled: boolean): Result<FieldUnique, DomainError> => {
  if (!enabled) {
    if (raw === true)
      return err(
        domainError.validation({ message: 'Field unique is not supported for this type' })
      );
    return ok(FieldUnique.disabled());
  }
  if (raw == null) return ok(FieldUnique.disabled());
  return FieldUnique.create(raw);
};

const resolveFieldValidation = (
  field: ResolvedTableFieldInput
): Result<FieldValidationConfig, DomainError> => {
  const isComputed = isComputedFieldType(field.type);
  const notNullEnabled = checkFieldNotNullValidationEnabled(field.type, { isComputed });
  const uniqueEnabled = checkFieldUniqueValidationEnabled(field.type, { isComputed });

  return parseFieldNotNull(field.notNull, notNullEnabled).andThen((notNull) =>
    parseFieldUnique(field.unique, uniqueEnabled).map((unique) => ({
      notNull,
      unique,
    }))
  );
};

type ParsedSelectOptions = {
  options: ReadonlyArray<SelectOption>;
  defaultValue?: SelectDefaultValue;
  preventAutoNewOptions?: SelectAutoNewOptions;
};

const parseSelectOptions = (raw: unknown): Result<ParsedSelectOptions, DomainError> => {
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

const parseFormulaFormatting = (
  raw: unknown
): Result<FormulaFormatting | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  const numberResult = NumberFormatting.create(raw);
  if (numberResult.isOk()) return ok(numberResult.value);
  const dateResult = DateTimeFormatting.create(raw);
  if (dateResult.isOk()) return ok(dateResult.value);
  return err(domainError.validation({ message: 'Invalid FormulaFormatting' }));
};

const parseFormulaShowAs = (raw: unknown): Result<FormulaShowAs | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  const numberResult = NumberShowAs.create(raw);
  if (numberResult.isOk()) return ok(numberResult.value);
  const textResult = SingleLineTextShowAs.create(raw);
  if (textResult.isOk()) return ok(textResult.value);
  return err(domainError.validation({ message: 'Invalid FormulaShowAs' }));
};

const parseTrackedFieldIds = (raw: unknown): Result<ReadonlyArray<FieldId>, DomainError> => {
  if (raw == null) return ok([]);
  const parsed = trackedFieldIdsSchema.safeParse(raw);
  if (!parsed.success) return err(domainError.validation({ message: 'Invalid trackedFieldIds' }));
  return sequence(parsed.data.map((entry) => FieldId.create(entry)));
};

const resolveFieldId = (id?: FieldId): Result<FieldId, DomainError> =>
  id ? ok(id) : FieldId.generate();

export const parseTableFieldSpec = (
  field: ResolvedTableFieldInput,
  options: { isPrimary: boolean }
): Result<ICreateTableFieldSpec, DomainError> => {
  return optional(field.id, FieldId.create).andThen((id) =>
    FieldName.create(field.name).andThen((name) =>
      resolveFieldValidation(field).andThen((validation) =>
        match(field)
          .with({ type: 'singleLineText' }, (field) =>
            optional(field.options?.showAs, SingleLineTextShowAs.create).andThen((showAs) =>
              optional(field.options?.defaultValue, TextDefaultValue.create).map((defaultValue) =>
                CreateSingleLineTextFieldSpec.create(id, name, {
                  isPrimary: options.isPrimary,
                  showAs,
                  defaultValue,
                  notNull: validation.notNull,
                  unique: validation.unique,
                })
              )
            )
          )
          .with({ type: 'longText' }, (field) =>
            optional(field.options?.defaultValue, TextDefaultValue.create).map((defaultValue) =>
              CreateLongTextFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                defaultValue,
                notNull: validation.notNull,
                unique: validation.unique,
              })
            )
          )
          .with({ type: 'number' }, (field) =>
            optional(field.options?.formatting, NumberFormatting.create).andThen((formatting) =>
              optional(field.options?.showAs, NumberShowAs.create).andThen((showAs) =>
                optional(field.options?.defaultValue, NumberDefaultValue.create).map(
                  (defaultValue) =>
                    CreateNumberFieldSpec.create(id, name, {
                      isPrimary: options.isPrimary,
                      formatting,
                      showAs,
                      defaultValue,
                      notNull: validation.notNull,
                      unique: validation.unique,
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
                    notNull: validation.notNull,
                    unique: validation.unique,
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
          .with({ type: 'rollup' }, (field) =>
            RollupExpression.create(field.options.expression).andThen((expression) =>
              RollupFieldConfig.create(field.config).andThen((config) =>
                optional(field.options.timeZone, TimeZone.create).andThen((timeZone) =>
                  parseFormulaFormatting(field.options.formatting).andThen((formatting) =>
                    parseFormulaShowAs(field.options.showAs).map((showAs) =>
                      CreateRollupFieldSpec.create(id, name, {
                        isPrimary: options.isPrimary,
                        config,
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
          )
          .with({ type: 'link' }, (field) =>
            LinkFieldConfig.create(field.options).map((config) =>
              CreateLinkFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                config,
                notNull: validation.notNull,
                unique: validation.unique,
              })
            )
          )
          .with({ type: 'lookup' }, (field) =>
            ok(
              CreateLookupFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                linkFieldId: field.options.linkFieldId,
                foreignTableId: field.options.foreignTableId,
                lookupFieldId: field.options.lookupFieldId,
                notNull: validation.notNull,
                unique: validation.unique,
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
                  notNull: validation.notNull,
                  unique: validation.unique,
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
                  notNull: validation.notNull,
                  unique: validation.unique,
                })
            )
          )
          .with({ type: 'checkbox' }, (field) =>
            optional(field.options?.defaultValue, CheckboxDefaultValue.create).map((defaultValue) =>
              CreateCheckboxFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                defaultValue,
                notNull: validation.notNull,
                unique: validation.unique,
              })
            )
          )
          .with({ type: 'attachment' }, () =>
            ok(
              CreateAttachmentFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                notNull: validation.notNull,
                unique: validation.unique,
              })
            )
          )
          .with({ type: 'date' }, (field) =>
            optional(field.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
              optional(field.options?.defaultValue, DateDefaultValue.create).map((defaultValue) =>
                CreateDateFieldSpec.create(id, name, {
                  isPrimary: options.isPrimary,
                  formatting,
                  defaultValue,
                  notNull: validation.notNull,
                  unique: validation.unique,
                })
              )
            )
          )
          .with({ type: 'createdTime' }, (field) =>
            optional(field.options?.formatting, DateTimeFormatting.create).map((formatting) =>
              CreateCreatedTimeFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                formatting,
              })
            )
          )
          .with({ type: 'lastModifiedTime' }, (field) =>
            optional(field.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
              parseTrackedFieldIds(field.options?.trackedFieldIds).map((trackedFieldIds) =>
                CreateLastModifiedTimeFieldSpec.create(id, name, {
                  isPrimary: options.isPrimary,
                  formatting,
                  trackedFieldIds,
                })
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
                        isPrimary: options.isPrimary,
                        isMultiple,
                        shouldNotify,
                        defaultValue,
                        notNull: validation.notNull,
                        unique: validation.unique,
                      })
                  )
              )
            )
          )
          .with({ type: 'createdBy' }, () =>
            ok(
              CreateCreatedByFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
              })
            )
          )
          .with({ type: 'lastModifiedBy' }, (field) =>
            parseTrackedFieldIds(field.options?.trackedFieldIds).map((trackedFieldIds) =>
              CreateLastModifiedByFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                trackedFieldIds,
              })
            )
          )
          .with({ type: 'autoNumber' }, () =>
            ok(
              CreateAutoNumberFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
              })
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
                          isPrimary: options.isPrimary,
                          label,
                          color,
                          maxCount,
                          resetCount,
                          workflow,
                          notNull: validation.notNull,
                          unique: validation.unique,
                        })
                      )
                  )
                )
              )
            )
          )
          .with({ type: 'conditionalRollup' }, (field) =>
            RollupExpression.create(field.options.expression).andThen((expression) =>
              ConditionalRollupConfig.create(field.config).andThen((config) =>
                optional(field.options.timeZone, TimeZone.create).andThen((timeZone) =>
                  parseFormulaFormatting(field.options.formatting).andThen((formatting) =>
                    parseFormulaShowAs(field.options.showAs).map((showAs) =>
                      CreateConditionalRollupFieldSpec.create(id, name, {
                        isPrimary: options.isPrimary,
                        config,
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
          )
          .with({ type: 'conditionalLookup' }, (field) =>
            ConditionalLookupOptions.create(field.options).map((conditionalLookupOptions) =>
              CreateConditionalLookupFieldSpec.create(id, name, {
                isPrimary: options.isPrimary,
                conditionalLookupOptions,
              })
            )
          )
          .exhaustive()
      )
    )
  );
};
