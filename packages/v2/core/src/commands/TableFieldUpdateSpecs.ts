import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { DbTableName } from '../domain/table/DbTableName';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import type { Field } from '../domain/table/fields/Field';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { AttachmentField } from '../domain/table/fields/types/AttachmentField';
import { AutoNumberField } from '../domain/table/fields/types/AutoNumberField';
import { ButtonField } from '../domain/table/fields/types/ButtonField';
import { ButtonLabel } from '../domain/table/fields/types/ButtonLabel';
import { ButtonMaxCount } from '../domain/table/fields/types/ButtonMaxCount';
import { ButtonWorkflow } from '../domain/table/fields/types/ButtonWorkflow';
import type { CellValueMultiplicity } from '../domain/table/fields/types/CellValueMultiplicity';
import type { CellValueType } from '../domain/table/fields/types/CellValueType';
import { CheckboxDefaultValue } from '../domain/table/fields/types/CheckboxDefaultValue';
import { CheckboxField } from '../domain/table/fields/types/CheckboxField';
import { ConditionalLookupField } from '../domain/table/fields/types/ConditionalLookupField';
import { ConditionalLookupOptions } from '../domain/table/fields/types/ConditionalLookupOptions';
import { ConditionalRollupConfig } from '../domain/table/fields/types/ConditionalRollupConfig';
import { ConditionalRollupField } from '../domain/table/fields/types/ConditionalRollupField';
import { CreatedByField } from '../domain/table/fields/types/CreatedByField';
import { CreatedTimeField } from '../domain/table/fields/types/CreatedTimeField';
import { DateDefaultValue } from '../domain/table/fields/types/DateDefaultValue';
import { DateField } from '../domain/table/fields/types/DateField';
import { DateTimeFormatting } from '../domain/table/fields/types/DateTimeFormatting';
import { FieldColor, fieldColorValues } from '../domain/table/fields/types/FieldColor';
import { FieldCondition } from '../domain/table/fields/types/FieldCondition';
import { FieldNotNull } from '../domain/table/fields/types/FieldNotNull';
import { FieldUnique } from '../domain/table/fields/types/FieldUnique';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import type { FormulaFormatting, FormulaShowAs } from '../domain/table/fields/types/FormulaField';
import { FormulaField } from '../domain/table/fields/types/FormulaField';
import { LastModifiedByField } from '../domain/table/fields/types/LastModifiedByField';
import { LastModifiedTimeField } from '../domain/table/fields/types/LastModifiedTimeField';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { LongTextField } from '../domain/table/fields/types/LongTextField';
import { LookupField } from '../domain/table/fields/types/LookupField';
import { LookupOptions } from '../domain/table/fields/types/LookupOptions';
import { MultipleSelectField } from '../domain/table/fields/types/MultipleSelectField';
import { NumberDefaultValue } from '../domain/table/fields/types/NumberDefaultValue';
import { NumberField } from '../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../domain/table/fields/types/NumberFormatting';
import { NumberShowAs } from '../domain/table/fields/types/NumberShowAs';
import { RatingColor } from '../domain/table/fields/types/RatingColor';
import { RatingField } from '../domain/table/fields/types/RatingField';
import { RatingIcon } from '../domain/table/fields/types/RatingIcon';
import { RatingMax } from '../domain/table/fields/types/RatingMax';
import { RollupExpression } from '../domain/table/fields/types/RollupExpression';
import { RollupField } from '../domain/table/fields/types/RollupField';
import { RollupFieldConfig } from '../domain/table/fields/types/RollupFieldConfig';
import { SelectAutoNewOptions } from '../domain/table/fields/types/SelectAutoNewOptions';
import { SelectDefaultValue } from '../domain/table/fields/types/SelectDefaultValue';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { SingleLineTextField } from '../domain/table/fields/types/SingleLineTextField';
import { SingleLineTextShowAs } from '../domain/table/fields/types/SingleLineTextShowAs';
import { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
import { TextDefaultValue } from '../domain/table/fields/types/TextDefaultValue';
import { TimeZone } from '../domain/table/fields/types/TimeZone';
import { UserDefaultValue } from '../domain/table/fields/types/UserDefaultValue';
import { UserField } from '../domain/table/fields/types/UserField';
import { UserMultiplicity } from '../domain/table/fields/types/UserMultiplicity';
import { UserNotification } from '../domain/table/fields/types/UserNotification';
import { FieldValueTypeVisitor } from '../domain/table/fields/visitors/FieldValueTypeVisitor';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { ForeignTable } from '../domain/table/ForeignTable';
import {
  UpdateButtonColorSpec,
  UpdateButtonLabelSpec,
  UpdateButtonMaxCountSpec,
  UpdateButtonWorkflowSpec,
  UpdateCheckboxDefaultValueSpec,
  UpdateDateDefaultValueSpec,
  UpdateDateFormattingSpec,
  UpdateFormulaExpressionSpec,
  UpdateFormulaFormattingSpec,
  UpdateFormulaShowAsSpec,
  UpdateFormulaTimeZoneSpec,
  UpdateLinkConfigSpec,
  UpdateLinkRelationshipSpec,
  UpdateLongTextDefaultValueSpec,
  UpdateLookupOptionsSpec,
  UpdateMultipleSelectAutoNewOptionsSpec,
  UpdateMultipleSelectDefaultValueSpec,
  UpdateMultipleSelectOptionsSpec,
  UpdateNumberDefaultValueSpec,
  UpdateNumberFormattingSpec,
  UpdateNumberShowAsSpec,
  UpdateRatingColorSpec,
  UpdateRatingIconSpec,
  UpdateRatingMaxSpec,
  UpdateRollupConfigSpec,
  UpdateRollupExpressionSpec,
  UpdateRollupFormattingSpec,
  UpdateRollupShowAsSpec,
  UpdateRollupTimeZoneSpec,
  UpdateSingleLineTextDefaultValueSpec,
  UpdateSingleLineTextShowAsSpec,
  UpdateSingleSelectAutoNewOptionsSpec,
  UpdateSingleSelectDefaultValueSpec,
  UpdateSingleSelectOptionsSpec,
  UpdateUserDefaultValueSpec,
  UpdateUserMultiplicitySpec,
  UpdateUserNotificationSpec,
} from '../domain/table/specs/field-updates';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldAiConfigSpec } from '../domain/table/specs/TableUpdateFieldAiConfigSpec';
import { TableUpdateFieldConstraintsSpec } from '../domain/table/specs/TableUpdateFieldConstraintsSpec';
import { TableUpdateFieldDbFieldNameSpec } from '../domain/table/specs/TableUpdateFieldDbFieldNameSpec';
import { TableUpdateFieldDescriptionSpec } from '../domain/table/specs/TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldNameSpec } from '../domain/table/specs/TableUpdateFieldNameSpec';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import type { IUpdateTableFieldSpec } from './IUpdateTableFieldSpec';

// ============ Helper functions ============

const optional = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, DomainError>
): Result<T | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  return parser(raw);
};

/**
 * Parse a value that can be explicitly cleared with null.
 * Returns { value: T | undefined, shouldClear: boolean }
 */
type ClearableResult<T> = { value: T | undefined; shouldClear: boolean };

const clearable = <T>(
  raw: unknown,
  wasProvided: boolean,
  parser: (value: unknown) => Result<T, DomainError>
): Result<ClearableResult<T>, DomainError> => {
  // Key was not provided at all
  if (!wasProvided) {
    return ok({ value: undefined, shouldClear: false });
  }
  // Key was explicitly set to null → clear
  if (raw === null) {
    return ok({ value: undefined, shouldClear: true });
  }
  // Key was provided with a value
  return parser(raw).map((value) => ({ value, shouldClear: false }));
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

const parseRequiredFormulaShowAs = (raw: unknown): Result<FormulaShowAs, DomainError> => {
  return parseFormulaShowAs(raw).andThen((showAs) =>
    showAs ? ok(showAs) : err(domainError.validation({ message: 'Invalid FormulaShowAs' }))
  );
};

const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );

const parseTrackedFieldIds = (
  raw: unknown
): Result<ReadonlyArray<FieldId> | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  if (!Array.isArray(raw)) {
    return err(domainError.validation({ message: 'Invalid trackedFieldIds' }));
  }
  return sequence(raw.map((entry) => FieldId.create(entry)));
};

const optionalEquals = <T extends { equals(other: T): boolean }>(
  a: T | undefined,
  b: T | undefined
): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.equals(b);
};

const fieldIdArrayEquals = (a: ReadonlyArray<FieldId>, b: ReadonlyArray<FieldId>): boolean => {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item.equals(b[index]));
};

const parseSelectOptionWithFallback = (
  choice: unknown,
  index: number
): Result<SelectOption, DomainError> => {
  if (typeof choice === 'string') {
    return SelectOption.create({
      name: choice,
      color: fieldColorValues[index % fieldColorValues.length],
    });
  }

  if (choice && typeof choice === 'object' && !Array.isArray(choice)) {
    const raw = choice as Record<string, unknown>;
    if (raw.color == null) {
      return SelectOption.create({
        ...raw,
        color: fieldColorValues[index % fieldColorValues.length],
      });
    }
  }

  return SelectOption.create(choice);
};

// Helper to build constraints spec
const buildConstraintsSpec = (
  currentField: Field,
  notNullValue: FieldNotNull | undefined,
  uniqueValue: FieldUnique | undefined
): ISpecification<Table, ITableSpecVisitor> | undefined => {
  if (notNullValue === undefined && uniqueValue === undefined) {
    return undefined;
  }
  const dbFieldNameResult = currentField.dbFieldName();
  if (dbFieldNameResult.isErr()) {
    return undefined;
  }
  const currentNotNull = currentField.notNull();
  const currentUnique = currentField.unique();
  const newNotNull = notNullValue ?? currentNotNull;
  const newUnique = uniqueValue ?? currentUnique;
  if (!newNotNull.equals(currentNotNull) || !newUnique.equals(currentUnique)) {
    return TableUpdateFieldConstraintsSpec.create({
      fieldId: currentField.id(),
      dbFieldName: dbFieldNameResult.value,
      previousNotNull: currentNotNull,
      nextNotNull: newNotNull,
      previousUnique: currentUnique,
      nextUnique: newUnique,
    });
  }
  return undefined;
};

const resolveDbFieldName = (field: Field): Result<DbFieldName, DomainError> => {
  const dbFieldNameResult = field.dbFieldName();
  if (dbFieldNameResult.isOk()) {
    return ok(dbFieldNameResult.value);
  }

  return DbFieldName.rehydrate(field.id().toString());
};

const ensureDbFieldName = (
  field: Field,
  fallbackDbFieldName?: string
): Result<void, DomainError> => {
  if (field.dbFieldName().isOk()) {
    return ok(undefined);
  }

  const candidate = fallbackDbFieldName ?? field.id().toString();
  return DbFieldName.rehydrate(candidate).andThen((dbFieldName) =>
    field.setDbFieldName(dbFieldName)
  );
};

// ============ UpdateSingleLineTextFieldSpec ============

class UpdateSingleLineTextFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly showAsValue: SingleLineTextShowAs | undefined,
    private readonly shouldClearShowAs: boolean,
    private readonly defaultValueValue: TextDefaultValue | undefined,
    private readonly shouldClearDefaultValue: boolean,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      showAs?: unknown;
      defaultValue?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateSingleLineTextFieldSpec, DomainError> {
    const hasShowAs = input.options !== undefined && 'showAs' in input.options;
    const hasDefaultValue = input.options !== undefined && 'defaultValue' in input.options;

    return optional(input.name, FieldName.create).andThen((name) =>
      clearable(input.options?.showAs, hasShowAs, SingleLineTextShowAs.create).andThen(
        (showAsResult) =>
          clearable(input.options?.defaultValue, hasDefaultValue, TextDefaultValue.create).andThen(
            (defaultValueResult) =>
              optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
                optional(input.unique, FieldUnique.create).map(
                  (unique) =>
                    new UpdateSingleLineTextFieldSpec(
                      name,
                      showAsResult.value,
                      showAsResult.shouldClear,
                      defaultValueResult.value,
                      defaultValueResult.shouldClear,
                      notNull,
                      unique
                    )
                )
              )
          )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof SingleLineTextField)) {
      return err(domainError.validation({ message: 'Expected SingleLineTextField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    // Handle showAs update or clear
    if (this.showAsValue !== undefined) {
      const currentShowAs = currentField.showAs();
      if (!currentShowAs || !this.showAsValue.equals(currentShowAs)) {
        specs.push(
          UpdateSingleLineTextShowAsSpec.create(currentField.id(), currentShowAs, this.showAsValue)
        );
      }
    } else if (this.shouldClearShowAs) {
      const currentShowAs = currentField.showAs();
      if (currentShowAs !== undefined) {
        specs.push(
          UpdateSingleLineTextShowAsSpec.create(currentField.id(), currentShowAs, undefined)
        );
      }
    }

    // Handle defaultValue update or clear
    if (this.defaultValueValue !== undefined) {
      const currentDefault = currentField.defaultValue();
      if (!currentDefault || !this.defaultValueValue.equals(currentDefault)) {
        specs.push(
          UpdateSingleLineTextDefaultValueSpec.create(
            currentField.id(),
            currentDefault,
            this.defaultValueValue
          )
        );
      }
    } else if (this.shouldClearDefaultValue) {
      const currentDefault = currentField.defaultValue();
      if (currentDefault !== undefined) {
        specs.push(
          UpdateSingleLineTextDefaultValueSpec.create(currentField.id(), currentDefault, undefined)
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateLongTextFieldSpec ============

class UpdateLongTextFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly defaultValueValue: TextDefaultValue | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      defaultValue?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateLongTextFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.defaultValue, TextDefaultValue.create).andThen((defaultValue) =>
        optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
          optional(input.unique, FieldUnique.create).map(
            (unique) => new UpdateLongTextFieldSpec(name, defaultValue, notNull, unique)
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof LongTextField)) {
      return err(domainError.validation({ message: 'Expected LongTextField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.defaultValueValue !== undefined) {
      const currentDefault = currentField.defaultValue();
      if (!currentDefault || !this.defaultValueValue.equals(currentDefault)) {
        specs.push(
          UpdateLongTextDefaultValueSpec.create(
            currentField.id(),
            currentDefault,
            this.defaultValueValue
          )
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateNumberFieldSpec ============

class UpdateNumberFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly formattingValue: NumberFormatting | undefined,
    private readonly showAsValue: NumberShowAs | undefined,
    private readonly defaultValueValue: NumberDefaultValue | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      formatting?: unknown;
      showAs?: unknown;
      defaultValue?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateNumberFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.formatting, NumberFormatting.create).andThen((formatting) =>
        optional(input.options?.showAs, NumberShowAs.create).andThen((showAs) =>
          optional(input.options?.defaultValue, NumberDefaultValue.create).andThen((defaultValue) =>
            optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
              optional(input.unique, FieldUnique.create).map(
                (unique) =>
                  new UpdateNumberFieldSpec(name, formatting, showAs, defaultValue, notNull, unique)
              )
            )
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof NumberField)) {
      return err(domainError.validation({ message: 'Expected NumberField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.formattingValue !== undefined) {
      const currentFormatting = currentField.formatting();
      if (!this.formattingValue.equals(currentFormatting)) {
        specs.push(
          UpdateNumberFormattingSpec.create(
            currentField.id(),
            currentFormatting,
            this.formattingValue
          )
        );
      }
    }

    if (this.showAsValue !== undefined) {
      const currentShowAs = currentField.showAs();
      if (!currentShowAs || !this.showAsValue.equals(currentShowAs)) {
        specs.push(
          UpdateNumberShowAsSpec.create(currentField.id(), currentShowAs, this.showAsValue)
        );
      }
    }

    if (this.defaultValueValue !== undefined) {
      const currentDefault = currentField.defaultValue();
      if (!currentDefault || !this.defaultValueValue.equals(currentDefault)) {
        specs.push(
          UpdateNumberDefaultValueSpec.create(
            currentField.id(),
            currentDefault,
            this.defaultValueValue
          )
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateRatingFieldSpec ============

class UpdateRatingFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly maxValue: RatingMax | undefined,
    private readonly iconValue: RatingIcon | undefined,
    private readonly colorValue: RatingColor | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      max?: unknown;
      icon?: unknown;
      color?: unknown;
    };
    max?: unknown;
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateRatingFieldSpec, DomainError> {
    const maxRaw = input.options?.max ?? input.max;
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(maxRaw, RatingMax.create).andThen((max) =>
        optional(input.options?.icon, RatingIcon.create).andThen((icon) =>
          optional(input.options?.color, RatingColor.create).andThen((color) =>
            optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
              optional(input.unique, FieldUnique.create).map(
                (unique) => new UpdateRatingFieldSpec(name, max, icon, color, notNull, unique)
              )
            )
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof RatingField)) {
      return err(domainError.validation({ message: 'Expected RatingField' }));
    }

    const dbFieldNameResult = resolveDbFieldName(currentField);
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);
    const dbFieldName = dbFieldNameResult.value;

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.maxValue !== undefined) {
      const currentMax = currentField.ratingMax();
      if (!this.maxValue.equals(currentMax)) {
        specs.push(
          UpdateRatingMaxSpec.create(currentField.id(), dbFieldName, currentMax, this.maxValue)
        );
      }
    }

    if (this.iconValue !== undefined) {
      const currentIcon = currentField.ratingIcon();
      if (!this.iconValue.equals(currentIcon)) {
        specs.push(UpdateRatingIconSpec.create(currentField.id(), currentIcon, this.iconValue));
      }
    }

    if (this.colorValue !== undefined) {
      const currentColor = currentField.ratingColor();
      if (!this.colorValue.equals(currentColor)) {
        specs.push(UpdateRatingColorSpec.create(currentField.id(), currentColor, this.colorValue));
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateDateFieldSpec ============

class UpdateDateFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly formattingValue: DateTimeFormatting | undefined,
    private readonly defaultValueValue: DateDefaultValue | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      formatting?: unknown;
      defaultValue?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateDateFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
        optional(input.options?.defaultValue, DateDefaultValue.create).andThen((defaultValue) =>
          optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
            optional(input.unique, FieldUnique.create).map(
              (unique) => new UpdateDateFieldSpec(name, formatting, defaultValue, notNull, unique)
            )
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof DateField)) {
      return err(domainError.validation({ message: 'Expected DateField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.formattingValue !== undefined) {
      const currentFormatting = currentField.formatting();
      if (!currentFormatting || !this.formattingValue.equals(currentFormatting)) {
        specs.push(
          UpdateDateFormattingSpec.create(
            currentField.id(),
            currentFormatting,
            this.formattingValue
          )
        );
      }
    }

    if (this.defaultValueValue !== undefined) {
      const currentDefault = currentField.defaultValue();
      if (!currentDefault || !this.defaultValueValue.equals(currentDefault)) {
        specs.push(
          UpdateDateDefaultValueSpec.create(
            currentField.id(),
            currentDefault,
            this.defaultValueValue
          )
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateCheckboxFieldSpec ============

class UpdateCheckboxFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly defaultValueValue: CheckboxDefaultValue | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      defaultValue?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateCheckboxFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.defaultValue, CheckboxDefaultValue.create).andThen((defaultValue) =>
        optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
          optional(input.unique, FieldUnique.create).map(
            (unique) => new UpdateCheckboxFieldSpec(name, defaultValue, notNull, unique)
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof CheckboxField)) {
      return err(domainError.validation({ message: 'Expected CheckboxField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.defaultValueValue !== undefined) {
      const currentDefault = currentField.defaultValue();
      if (!currentDefault || !this.defaultValueValue.equals(currentDefault)) {
        specs.push(
          UpdateCheckboxDefaultValueSpec.create(
            currentField.id(),
            currentDefault,
            this.defaultValueValue
          )
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateAttachmentFieldSpec ============

class UpdateAttachmentFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateAttachmentFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
        optional(input.unique, FieldUnique.create).map(
          (unique) => new UpdateAttachmentFieldSpec(name, notNull, unique)
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof AttachmentField)) {
      return err(domainError.validation({ message: 'Expected AttachmentField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateCreatedTimeFieldSpec ============

class UpdateCreatedTimeFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly formattingValue: DateTimeFormatting | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      formatting?: unknown;
    };
  }): Result<UpdateCreatedTimeFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.formatting, DateTimeFormatting.create).map(
        (formatting) => new UpdateCreatedTimeFieldSpec(name, formatting)
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof CreatedTimeField)) {
      return err(domainError.validation({ message: 'Expected CreatedTimeField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];
    const nextName = this.nameValue ?? currentField.name();

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (
      this.formattingValue !== undefined &&
      !this.formattingValue.equals(currentField.formatting())
    ) {
      const updatedFieldResult = CreatedTimeField.create({
        id: currentField.id(),
        name: nextName,
        formatting: this.formattingValue,
        meta: currentField.meta(),
      });
      if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);
      specs.push(TableUpdateFieldTypeSpec.create(currentField, updatedFieldResult.value));
    }

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateLastModifiedTimeFieldSpec ============

class UpdateLastModifiedTimeFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly formattingValue: DateTimeFormatting | undefined,
    private readonly trackedFieldIdsValue: ReadonlyArray<FieldId> | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      formatting?: unknown;
      trackedFieldIds?: unknown;
    };
  }): Result<UpdateLastModifiedTimeFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
        parseTrackedFieldIds(input.options?.trackedFieldIds).map(
          (trackedFieldIds) =>
            new UpdateLastModifiedTimeFieldSpec(name, formatting, trackedFieldIds)
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof LastModifiedTimeField)) {
      return err(domainError.validation({ message: 'Expected LastModifiedTimeField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];
    const nextName = this.nameValue ?? currentField.name();

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    const currentFormatting = currentField.formatting();
    const currentTrackedFieldIds = currentField.trackedFieldIds();
    const nextFormatting = this.formattingValue ?? currentFormatting;
    const nextTrackedFieldIds = this.trackedFieldIdsValue ?? currentTrackedFieldIds;
    const formattingChanged =
      this.formattingValue !== undefined && !this.formattingValue.equals(currentFormatting);
    const trackedChanged =
      this.trackedFieldIdsValue !== undefined &&
      !fieldIdArrayEquals(this.trackedFieldIdsValue, currentTrackedFieldIds);

    if (formattingChanged || trackedChanged) {
      const updatedFieldResult = LastModifiedTimeField.create({
        id: currentField.id(),
        name: nextName,
        formatting: nextFormatting,
        trackedFieldIds: nextTrackedFieldIds,
        meta: currentField.meta(),
      });
      if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);
      specs.push(TableUpdateFieldTypeSpec.create(currentField, updatedFieldResult.value));
    }

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateCreatedByFieldSpec ============

class UpdateCreatedByFieldSpec implements IUpdateTableFieldSpec {
  private constructor(private readonly nameValue: FieldName | undefined) {}

  static create(input: { name?: string }): Result<UpdateCreatedByFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).map((name) => new UpdateCreatedByFieldSpec(name));
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof CreatedByField)) {
      return err(domainError.validation({ message: 'Expected CreatedByField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];
    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }
    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateLastModifiedByFieldSpec ============

class UpdateLastModifiedByFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly trackedFieldIdsValue: ReadonlyArray<FieldId> | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      trackedFieldIds?: unknown;
    };
  }): Result<UpdateLastModifiedByFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      parseTrackedFieldIds(input.options?.trackedFieldIds).map(
        (trackedFieldIds) => new UpdateLastModifiedByFieldSpec(name, trackedFieldIds)
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof LastModifiedByField)) {
      return err(domainError.validation({ message: 'Expected LastModifiedByField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];
    const nextName = this.nameValue ?? currentField.name();

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    const currentTrackedFieldIds = currentField.trackedFieldIds();
    const nextTrackedFieldIds = this.trackedFieldIdsValue ?? currentTrackedFieldIds;
    const trackedChanged =
      this.trackedFieldIdsValue !== undefined &&
      !fieldIdArrayEquals(this.trackedFieldIdsValue, currentTrackedFieldIds);

    if (trackedChanged) {
      const updatedFieldResult = LastModifiedByField.create({
        id: currentField.id(),
        name: nextName,
        trackedFieldIds: nextTrackedFieldIds,
        meta: currentField.meta(),
      });
      if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);
      specs.push(TableUpdateFieldTypeSpec.create(currentField, updatedFieldResult.value));
    }

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateAutoNumberFieldSpec ============

class UpdateAutoNumberFieldSpec implements IUpdateTableFieldSpec {
  private constructor(private readonly nameValue: FieldName | undefined) {}

  static create(input: { name?: string }): Result<UpdateAutoNumberFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).map(
      (name) => new UpdateAutoNumberFieldSpec(name)
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof AutoNumberField)) {
      return err(domainError.validation({ message: 'Expected AutoNumberField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];
    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }
    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateConditionalLookupFieldSpec ============

class UpdateConditionalLookupFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly optionsValue: ConditionalLookupOptions | undefined,
    private readonly innerTypeValue: string | undefined,
    private readonly innerOptionsValue: Record<string, unknown> | undefined,
    private readonly innerCellValueTypeValue: string | undefined,
    private readonly innerIsMultipleCellValueValue: boolean | undefined,
    private readonly foreignTablesValue: ReadonlyArray<Table> | undefined
  ) {}

  static create(
    input: {
      name?: string;
      options?: unknown;
      cellValueType?: unknown;
      isMultipleCellValue?: unknown;
    },
    context?: {
      foreignTables?: ReadonlyArray<Table>;
    }
  ): Result<UpdateConditionalLookupFieldSpec, DomainError> {
    const optionsRaw =
      input.options && typeof input.options === 'object' && !Array.isArray(input.options)
        ? (input.options as Record<string, unknown>)
        : undefined;

    const parseConditionalLookupOptions = (): Result<
      ConditionalLookupOptions | undefined,
      DomainError
    > => {
      if (!optionsRaw) {
        return ok(undefined);
      }

      const hasConditionInput =
        optionsRaw.foreignTableId != null ||
        optionsRaw.lookupFieldId != null ||
        optionsRaw.condition != null ||
        optionsRaw.filter != null ||
        optionsRaw.sort != null ||
        optionsRaw.limit != null;

      if (!hasConditionInput) {
        return ok(undefined);
      }

      const normalizedCondition =
        optionsRaw.condition && typeof optionsRaw.condition === 'object'
          ? optionsRaw.condition
          : {
              filter: optionsRaw.filter ?? null,
              ...(optionsRaw.sort != null ? { sort: optionsRaw.sort } : {}),
              ...(optionsRaw.limit != null ? { limit: optionsRaw.limit } : {}),
            };

      return ConditionalLookupOptions.create({
        foreignTableId: optionsRaw.foreignTableId,
        lookupFieldId: optionsRaw.lookupFieldId,
        condition: normalizedCondition,
      }).map((value) => value);
    };

    const parseInnerOptions = (): Record<string, unknown> | undefined => {
      if (!optionsRaw) {
        return undefined;
      }

      if (optionsRaw.innerOptions && typeof optionsRaw.innerOptions === 'object') {
        return optionsRaw.innerOptions as Record<string, unknown>;
      }

      const reservedKeys = new Set([
        'foreignTableId',
        'lookupFieldId',
        'condition',
        'filter',
        'sort',
        'limit',
        'innerType',
      ]);
      const entries = Object.entries(optionsRaw).filter(([key]) => !reservedKeys.has(key));
      if (entries.length === 0) {
        return undefined;
      }
      return Object.fromEntries(entries);
    };

    return optional(input.name, FieldName.create).andThen((name) =>
      parseConditionalLookupOptions().map(
        (options) =>
          new UpdateConditionalLookupFieldSpec(
            name,
            options,
            typeof optionsRaw?.innerType === 'string' ? optionsRaw.innerType : undefined,
            parseInnerOptions(),
            typeof input.cellValueType === 'string' ? input.cellValueType : undefined,
            typeof input.isMultipleCellValue === 'boolean' ? input.isMultipleCellValue : undefined,
            context?.foreignTables
          )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof ConditionalLookupField)) {
      return err(domainError.validation({ message: 'Expected ConditionalLookupField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];
    const nextName = this.nameValue ?? currentField.name();
    const currentOptions = currentField.conditionalLookupOptions();
    const nextOptions = this.optionsValue ?? currentOptions;
    const conditionChanged =
      this.optionsValue !== undefined && !this.optionsValue.equals(currentOptions);
    const innerChanged = this.innerTypeValue !== undefined || this.innerOptionsValue !== undefined;

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (conditionChanged || innerChanged) {
      const isMultipleResult = currentField.isMultipleCellValue();
      if (isMultipleResult.isErr()) return err(isMultipleResult.error);

      const updatedFieldResult = this.buildUpdatedConditionalLookupField({
        currentField,
        nextName,
        nextOptions,
        isMultipleCellValue: isMultipleResult.value.isMultiple(),
      });
      if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);
      const typeSpec = TableUpdateFieldTypeSpec.create(currentField, updatedFieldResult.value);
      specs.push(typeSpec);
    }

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    if (this.optionsValue) {
      return ok([{ foreignTableId: this.optionsValue.foreignTableId() }]);
    }
    return ok([]);
  }

  private buildUpdatedConditionalLookupField(params: {
    currentField: ConditionalLookupField;
    nextName: FieldName;
    nextOptions: ConditionalLookupOptions;
    isMultipleCellValue: boolean;
  }): Result<ConditionalLookupField, DomainError> {
    const nextInnerFieldResult = this.buildUpdatedInnerField(
      params.currentField,
      params.nextOptions
    );
    if (nextInnerFieldResult.isErr()) {
      return err(nextInnerFieldResult.error);
    }
    const nextInnerField = nextInnerFieldResult.value;

    if (nextInnerField) {
      return ConditionalLookupField.create({
        id: params.currentField.id(),
        name: params.nextName,
        innerField: nextInnerField,
        conditionalLookupOptions: params.nextOptions,
        isMultipleCellValue: params.isMultipleCellValue,
        dependencies: params.currentField.dependencies(),
      });
    }

    return ConditionalLookupField.createPending({
      id: params.currentField.id(),
      name: params.nextName,
      conditionalLookupOptions: params.nextOptions,
      isMultipleCellValue: params.isMultipleCellValue,
      dependencies: params.currentField.dependencies(),
    });
  }

  private buildUpdatedInnerField(
    currentField: ConditionalLookupField,
    nextOptions: ConditionalLookupOptions
  ): Result<Field | undefined, DomainError> {
    const currentInnerFieldResult = currentField.innerField();
    const hasInnerUpdate =
      this.innerTypeValue !== undefined || this.innerOptionsValue !== undefined;

    if (!hasInnerUpdate) {
      return currentInnerFieldResult.match(
        (innerField) => ok(innerField),
        () => ok(undefined)
      );
    }

    const currentInnerType = currentInnerFieldResult.match(
      (field) => field.type().toString(),
      () => undefined
    );
    const nextInnerType = this.innerTypeValue ?? currentInnerType;
    if (!nextInnerType) {
      return err(
        domainError.validation({
          message: 'Conditional lookup innerType is required when updating inner options',
        })
      );
    }

    const parseFieldInput: Record<string, unknown> = {
      id: currentField.id().toString(),
      name: currentField.name().toString(),
      type: nextInnerType,
      options: this.innerOptionsValue,
    };
    const shouldCarryInnerValueType =
      currentInnerFieldResult.isOk() &&
      (this.innerTypeValue === undefined || this.innerTypeValue === currentInnerType);
    if (shouldCarryInnerValueType) {
      const currentInnerValueTypeResult = currentInnerFieldResult.value.accept(
        new FieldValueTypeVisitor()
      );
      if (currentInnerValueTypeResult.isOk()) {
        parseFieldInput.cellValueType = currentInnerValueTypeResult.value.cellValueType.toString();
        parseFieldInput.isMultipleCellValue =
          currentInnerValueTypeResult.value.isMultipleCellValue.toBoolean();
      }
    }
    if (parseFieldInput.cellValueType == null && this.innerCellValueTypeValue != null) {
      parseFieldInput.cellValueType = this.innerCellValueTypeValue;
    }
    if (parseFieldInput.isMultipleCellValue == null && this.innerIsMultipleCellValueValue != null) {
      parseFieldInput.isMultipleCellValue = this.innerIsMultipleCellValueValue;
    }
    if (parseFieldInput.cellValueType == null && nextInnerType === 'formula') {
      const inferredInnerFormulaResultType = this.inferInnerFormulaResultType(
        nextOptions,
        parseFieldInput.options
      );
      if (inferredInnerFormulaResultType.isErr()) {
        return err(inferredInnerFormulaResultType.error);
      }
      parseFieldInput.cellValueType = inferredInnerFormulaResultType.value.cellValueType;
      parseFieldInput.isMultipleCellValue =
        inferredInnerFormulaResultType.value.isMultipleCellValue;
    }

    const parseResult = parseTableFieldSpec(
      parseFieldInput as Parameters<typeof parseTableFieldSpec>[0],
      { isPrimary: false }
    );
    if (parseResult.isErr()) {
      return err(parseResult.error);
    }

    return parseResult.value.createField();
  }

  private inferInnerFormulaResultType(
    options: ConditionalLookupOptions,
    rawInnerOptions: unknown
  ): Result<{ cellValueType: string; isMultipleCellValue: boolean }, DomainError> {
    if (!this.foreignTablesValue || this.foreignTablesValue.length === 0) {
      return err(
        domainError.invariant({
          message:
            'Cannot derive conditional lookup inner formula result type: foreign tables not loaded',
        })
      );
    }

    if (!rawInnerOptions || typeof rawInnerOptions !== 'object' || Array.isArray(rawInnerOptions)) {
      return err(
        domainError.validation({
          message:
            'Cannot derive conditional lookup inner formula result type: innerOptions are required',
        })
      );
    }

    const expressionRaw = (rawInnerOptions as Record<string, unknown>).expression;
    if (typeof expressionRaw !== 'string') {
      return err(
        domainError.validation({
          message:
            'Cannot derive conditional lookup inner formula result type: innerOptions.expression is required',
        })
      );
    }

    const foreignTable = this.foreignTablesValue.find((table) =>
      table.id().equals(options.foreignTableId())
    );
    if (!foreignTable) {
      return err(
        domainError.validation({
          message:
            'Cannot derive conditional lookup inner formula result type: foreign table not found',
        })
      );
    }

    const valueTypeVisitor = new FieldValueTypeVisitor();
    const fieldValueTypes = foreignTable.getFields().flatMap((field) => {
      const valueTypeResult = field.accept(valueTypeVisitor);
      if (valueTypeResult.isErr()) return [];
      return [{ id: field.id(), valueType: valueTypeResult.value }];
    });

    return FormulaExpression.create(expressionRaw).andThen((expression) =>
      expression.getParsedValueType(fieldValueTypes).map((resultType) => ({
        cellValueType: resultType.cellValueType.toString(),
        isMultipleCellValue: resultType.isMultipleCellValue.toBoolean(),
      }))
    );
  }
}

// ============ UpdateConditionalRollupFieldSpec ============

class UpdateConditionalRollupFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly configValue: ConditionalRollupConfig | undefined,
    private readonly expressionValue: RollupExpression | undefined,
    private readonly timeZoneValue: TimeZone | undefined,
    private readonly formattingValue: FormulaFormatting | undefined,
    private readonly showAsValue: FormulaShowAs | undefined,
    private readonly shouldClearShowAs: boolean,
    private readonly foreignTablesValue: ReadonlyArray<Table> | undefined
  ) {}

  static create(
    input: {
      name?: string;
      config?: unknown;
      options?: {
        expression?: unknown;
        timeZone?: unknown;
        formatting?: unknown;
        showAs?: unknown;
      };
    },
    context?: {
      foreignTables?: ReadonlyArray<Table>;
    }
  ): Result<UpdateConditionalRollupFieldSpec, DomainError> {
    const hasShowAs = input.options !== undefined && 'showAs' in input.options;
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.config, ConditionalRollupConfig.create).andThen((config) =>
        optional(input.options?.expression, RollupExpression.create).andThen((expression) =>
          optional(input.options?.timeZone, TimeZone.create).andThen((timeZone) =>
            parseFormulaFormatting(input.options?.formatting).andThen((formatting) =>
              clearable(input.options?.showAs, hasShowAs, parseRequiredFormulaShowAs).map(
                (showAsResult) =>
                  new UpdateConditionalRollupFieldSpec(
                    name,
                    config,
                    expression,
                    timeZone,
                    formatting,
                    showAsResult.value,
                    showAsResult.shouldClear,
                    context?.foreignTables
                  )
              )
            )
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof ConditionalRollupField)) {
      return err(domainError.validation({ message: 'Expected ConditionalRollupField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];
    const nextName = this.nameValue ?? currentField.name();

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    const currentConfig = currentField.config();
    const currentExpression = currentField.expression();
    const currentTimeZone = currentField.timeZone();
    const currentFormatting = currentField.formatting();
    const currentShowAs = currentField.showAs();
    let nextConfig = this.configValue ?? currentConfig;
    const nextExpression = this.expressionValue ?? currentExpression;
    const nextTimeZone = this.timeZoneValue ?? currentTimeZone;
    let nextFormatting = this.formattingValue ?? currentFormatting;
    const nextShowAs = this.shouldClearShowAs ? undefined : this.showAsValue ?? currentShowAs;

    // Resolve the valuesType from the foreign table's lookup field when available.
    // This is necessary because the current field's cellValueType is the *result* of
    // the old expression (e.g. Number from count), not the lookup field's type
    // (e.g. DateTime). Using the wrong valuesType would produce wrong resultType
    // for the new expression (e.g. max(DateTime) should be DateTime, not max(Number)=Number).
    const valuesTypeResult = this.resolveValuesType(currentField, nextConfig);

    // When expression changes to single-value aggregation, clear sort/limit from condition
    if (this.expressionValue !== undefined && !this.expressionValue.equals(currentExpression)) {
      if (valuesTypeResult.isOk()) {
        const parsedTypeResult = nextExpression.getParsedValueType(valuesTypeResult.value);
        if (parsedTypeResult.isOk()) {
          const willBeSingleValue = !parsedTypeResult.value.isMultipleCellValue.toBoolean();
          const condition = nextConfig.condition();

          if (willBeSingleValue && (condition.hasSort() || condition.hasLimit())) {
            // Clear sort and limit from condition
            const conditionDto = condition.toDto();
            const clearedConditionResult = FieldCondition.create({
              ...conditionDto,
              sort: undefined,
              limit: undefined,
            });
            if (clearedConditionResult.isErr()) return err(clearedConditionResult.error);

            const clearedConfigResult = ConditionalRollupConfig.create({
              foreignTableId: nextConfig.foreignTableId().toString(),
              lookupFieldId: nextConfig.lookupFieldId().toString(),
              condition: clearedConditionResult.value.toDto(),
            });
            if (clearedConfigResult.isErr()) return err(clearedConfigResult.error);
            nextConfig = clearedConfigResult.value;
          }
        }
      }
    }

    const configChanged =
      (this.configValue !== undefined && !this.configValue.equals(currentConfig)) ||
      !nextConfig.equals(currentConfig);
    const expressionChanged =
      this.expressionValue !== undefined && !this.expressionValue.equals(currentExpression);
    const timeZoneChanged =
      this.timeZoneValue !== undefined && !optionalEquals(this.timeZoneValue, currentTimeZone);
    const formattingChanged =
      this.formattingValue !== undefined &&
      !optionalEquals(this.formattingValue, currentFormatting);
    const showAsChanged =
      (this.showAsValue !== undefined && !optionalEquals(this.showAsValue, currentShowAs)) ||
      (this.shouldClearShowAs && currentShowAs !== undefined);

    if (
      configChanged ||
      expressionChanged ||
      timeZoneChanged ||
      formattingChanged ||
      showAsChanged
    ) {
      // Compute the correct resultType for the new expression + valuesField.
      // When foreignTables are available, use the lookup field's actual type.
      let resultType: { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity };

      if (valuesTypeResult.isOk()) {
        const parsedTypeResult = nextExpression.getParsedValueType(valuesTypeResult.value);
        if (parsedTypeResult.isErr()) return err(parsedTypeResult.error);
        resultType = parsedTypeResult.value;
      } else {
        // For expression/config changes, we MUST have valid valuesType from foreign table
        // to determine the correct result type. Fallback to current field's type is unsafe
        // during type conversions because it would use stale metadata.
        return err(
          domainError.validation({
            message: `Cannot determine result type for conditional rollup update: ${valuesTypeResult.error.message}`,
          })
        );
      }

      // When the result type changes, reset formatting to match the new type
      if (!this.formattingValue) {
        const currentCellValueTypeResult = currentField.cellValueType();
        if (
          currentCellValueTypeResult.isOk() &&
          !currentCellValueTypeResult.value.equals(resultType.cellValueType)
        ) {
          nextFormatting = ConditionalRollupField.defaultFormatting(resultType.cellValueType);
        }
      }

      const updatedFieldResult = ConditionalRollupField.createPending({
        id: currentField.id(),
        name: nextName,
        config: nextConfig,
        expression: nextExpression,
        timeZone: nextTimeZone,
        formatting: nextFormatting,
        showAs: nextShowAs,
        resultType,
        dependencies: currentField.dependencies(),
      });
      if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);
      specs.push(TableUpdateFieldTypeSpec.create(currentField, updatedFieldResult.value));
    }

    return ok(specs);
  }

  /**
   * Resolve the valuesType (lookup field's type) from the foreign table.
   * Returns err if foreign tables are not available or lookup field is not found.
   */
  private resolveValuesType(
    _currentField: ConditionalRollupField,
    config: ConditionalRollupConfig
  ): Result<
    { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity },
    DomainError
  > {
    if (!this.foreignTablesValue || this.foreignTablesValue.length === 0) {
      return err(domainError.invariant({ message: 'Foreign tables not available' }));
    }

    const foreignTable = this.foreignTablesValue.find((t) =>
      t.id().equals(config.foreignTableId())
    );
    if (!foreignTable) {
      return err(domainError.invariant({ message: 'Foreign table not found' }));
    }

    const lookupFieldResult = ForeignTable.from(foreignTable).fieldById(config.lookupFieldId());
    if (lookupFieldResult.isErr()) {
      return err(domainError.invariant({ message: 'Lookup field not found' }));
    }

    return lookupFieldResult.value.accept(new FieldValueTypeVisitor()).map((vt) => ({
      cellValueType: vt.cellValueType,
      isMultipleCellValue: vt.isMultipleCellValue,
    }));
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    if (this.configValue) {
      return ok([{ foreignTableId: this.configValue.foreignTableId() }]);
    }
    return ok([]);
  }
}

// ============ UpdateSingleSelectFieldSpec ============

class UpdateSingleSelectFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly optionsValue: ReadonlyArray<SelectOption> | undefined,
    private readonly defaultValueValue: SelectDefaultValue | undefined,
    private readonly preventAutoNewOptionsValue: SelectAutoNewOptions | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      choices?: unknown[];
      defaultValue?: unknown;
      preventAutoNewOptions?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateSingleSelectFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) => {
      const parseOptions = (): Result<ReadonlyArray<SelectOption> | undefined, DomainError> => {
        if (!input.options?.choices) return ok(undefined);
        return sequence(
          (input.options.choices as unknown[]).map((choice, index) =>
            parseSelectOptionWithFallback(choice, index)
          )
        );
      };

      return parseOptions().andThen((options) =>
        optional(input.options?.defaultValue, SelectDefaultValue.create).andThen((defaultValue) =>
          optional(input.options?.preventAutoNewOptions, SelectAutoNewOptions.create).andThen(
            (preventAutoNewOptions) =>
              optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
                optional(input.unique, FieldUnique.create).map(
                  (unique) =>
                    new UpdateSingleSelectFieldSpec(
                      name,
                      options,
                      defaultValue,
                      preventAutoNewOptions,
                      notNull,
                      unique
                    )
                )
              )
          )
        )
      );
    });
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof SingleSelectField)) {
      return err(domainError.validation({ message: 'Expected SingleSelectField' }));
    }

    const dbFieldNameResult = resolveDbFieldName(currentField);
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);
    const dbFieldName = dbFieldNameResult.value;

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.optionsValue !== undefined) {
      const currentOptions = currentField.selectOptions();
      specs.push(
        UpdateSingleSelectOptionsSpec.create(
          currentField.id(),
          dbFieldName,
          currentOptions,
          this.optionsValue
        )
      );
    }

    if (this.defaultValueValue !== undefined) {
      const currentDefault = currentField.defaultValue();
      if (!currentDefault || !this.defaultValueValue.equals(currentDefault)) {
        specs.push(
          UpdateSingleSelectDefaultValueSpec.create(
            currentField.id(),
            currentDefault,
            this.defaultValueValue
          )
        );
      }
    }

    if (this.preventAutoNewOptionsValue !== undefined) {
      const currentPrevent = currentField.preventAutoNewOptions();
      if (!this.preventAutoNewOptionsValue.equals(currentPrevent)) {
        specs.push(
          UpdateSingleSelectAutoNewOptionsSpec.create(
            currentField.id(),
            currentPrevent,
            this.preventAutoNewOptionsValue
          )
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateMultipleSelectFieldSpec ============

class UpdateMultipleSelectFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly optionsValue: ReadonlyArray<SelectOption> | undefined,
    private readonly defaultValueValue: SelectDefaultValue | undefined,
    private readonly preventAutoNewOptionsValue: SelectAutoNewOptions | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      choices?: unknown[];
      defaultValue?: unknown;
      preventAutoNewOptions?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateMultipleSelectFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) => {
      const parseOptions = (): Result<ReadonlyArray<SelectOption> | undefined, DomainError> => {
        if (!input.options?.choices) return ok(undefined);
        return sequence(
          (input.options.choices as unknown[]).map((choice, index) =>
            parseSelectOptionWithFallback(choice, index)
          )
        );
      };

      return parseOptions().andThen((options) =>
        optional(input.options?.defaultValue, SelectDefaultValue.create).andThen((defaultValue) =>
          optional(input.options?.preventAutoNewOptions, SelectAutoNewOptions.create).andThen(
            (preventAutoNewOptions) =>
              optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
                optional(input.unique, FieldUnique.create).map(
                  (unique) =>
                    new UpdateMultipleSelectFieldSpec(
                      name,
                      options,
                      defaultValue,
                      preventAutoNewOptions,
                      notNull,
                      unique
                    )
                )
              )
          )
        )
      );
    });
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof MultipleSelectField)) {
      return err(domainError.validation({ message: 'Expected MultipleSelectField' }));
    }

    const dbFieldNameResult = resolveDbFieldName(currentField);
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);
    const dbFieldName = dbFieldNameResult.value;

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.optionsValue !== undefined) {
      const currentOptions = currentField.selectOptions();
      specs.push(
        UpdateMultipleSelectOptionsSpec.create(
          currentField.id(),
          dbFieldName,
          currentOptions,
          this.optionsValue
        )
      );
    }

    if (this.defaultValueValue !== undefined) {
      const currentDefault = currentField.defaultValue();
      if (!currentDefault || !this.defaultValueValue.equals(currentDefault)) {
        specs.push(
          UpdateMultipleSelectDefaultValueSpec.create(
            currentField.id(),
            currentDefault,
            this.defaultValueValue
          )
        );
      }
    }

    if (this.preventAutoNewOptionsValue !== undefined) {
      const currentPrevent = currentField.preventAutoNewOptions();
      if (!this.preventAutoNewOptionsValue.equals(currentPrevent)) {
        specs.push(
          UpdateMultipleSelectAutoNewOptionsSpec.create(
            currentField.id(),
            currentPrevent,
            this.preventAutoNewOptionsValue
          )
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateFormulaFieldSpec ============

class UpdateFormulaFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly expressionValue: FormulaExpression | undefined,
    private readonly timeZoneValue: TimeZone | undefined,
    private readonly formattingValue: FormulaFormatting | undefined,
    private readonly showAsValue: FormulaShowAs | undefined,
    private readonly shouldClearShowAs: boolean
  ) {}

  static create(input: {
    name?: string;
    options?: {
      expression?: string;
      timeZone?: string;
      formatting?: unknown;
      showAs?: unknown;
    };
  }): Result<UpdateFormulaFieldSpec, DomainError> {
    const hasShowAs = input.options !== undefined && 'showAs' in input.options;
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.expression, FormulaExpression.create).andThen((expression) =>
        optional(input.options?.timeZone, TimeZone.create).andThen((timeZone) =>
          parseFormulaFormatting(input.options?.formatting).andThen((formatting) =>
            clearable(input.options?.showAs, hasShowAs, parseRequiredFormulaShowAs).map(
              (showAsResult) =>
                new UpdateFormulaFieldSpec(
                  name,
                  expression,
                  timeZone,
                  formatting,
                  showAsResult.value,
                  showAsResult.shouldClear
                )
            )
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof FormulaField)) {
      return err(domainError.validation({ message: 'Expected FormulaField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.expressionValue !== undefined) {
      const currentExpression = currentField.expression();
      if (!this.expressionValue.equals(currentExpression)) {
        specs.push(
          UpdateFormulaExpressionSpec.create(
            currentField.id(),
            currentExpression,
            this.expressionValue
          )
        );
      }
    }

    if (this.timeZoneValue !== undefined) {
      const currentTimeZone = currentField.timeZone();
      if (!currentTimeZone || !this.timeZoneValue.equals(currentTimeZone)) {
        specs.push(
          UpdateFormulaTimeZoneSpec.create(currentField.id(), currentTimeZone, this.timeZoneValue)
        );
      }
    }

    if (this.formattingValue !== undefined) {
      const currentFormatting = currentField.formatting();
      specs.push(
        UpdateFormulaFormattingSpec.create(
          currentField.id(),
          currentFormatting,
          this.formattingValue
        )
      );
    }

    if (this.showAsValue !== undefined) {
      const currentShowAs = currentField.showAs();
      specs.push(
        UpdateFormulaShowAsSpec.create(currentField.id(), currentShowAs, this.showAsValue)
      );
    } else if (this.shouldClearShowAs) {
      const currentShowAs = currentField.showAs();
      if (currentShowAs !== undefined) {
        specs.push(UpdateFormulaShowAsSpec.create(currentField.id(), currentShowAs, undefined));
      }
    }

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateRollupFieldSpec ============

class UpdateRollupFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly configValue: RollupFieldConfig | undefined,
    private readonly expressionValue: RollupExpression | undefined,
    private readonly timeZoneValue: TimeZone | undefined,
    private readonly formattingValue: FormulaFormatting | undefined,
    private readonly showAsValue: FormulaShowAs | undefined,
    private readonly shouldClearShowAs: boolean
  ) {}

  static create(input: {
    name?: string;
    config?: unknown;
    options?: {
      expression?: string;
      timeZone?: string;
      formatting?: unknown;
      showAs?: unknown;
    };
  }): Result<UpdateRollupFieldSpec, DomainError> {
    const hasShowAs = input.options !== undefined && 'showAs' in input.options;
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.config, RollupFieldConfig.create).andThen((config) =>
        optional(input.options?.expression, RollupExpression.create).andThen((expression) =>
          optional(input.options?.timeZone, TimeZone.create).andThen((timeZone) =>
            parseFormulaFormatting(input.options?.formatting).andThen((formatting) =>
              clearable(input.options?.showAs, hasShowAs, parseRequiredFormulaShowAs).map(
                (showAsResult) =>
                  new UpdateRollupFieldSpec(
                    name,
                    config,
                    expression,
                    timeZone,
                    formatting,
                    showAsResult.value,
                    showAsResult.shouldClear
                  )
              )
            )
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof RollupField)) {
      return err(domainError.validation({ message: 'Expected RollupField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.configValue !== undefined) {
      const currentConfig = currentField.config();
      specs.push(UpdateRollupConfigSpec.create(currentField.id(), currentConfig, this.configValue));
    }

    if (this.expressionValue !== undefined) {
      const currentExpression = currentField.expression();
      if (!this.expressionValue.equals(currentExpression)) {
        specs.push(
          UpdateRollupExpressionSpec.create(
            currentField.id(),
            currentExpression,
            this.expressionValue
          )
        );
      }
    }

    if (this.timeZoneValue !== undefined) {
      const currentTimeZone = currentField.timeZone();
      if (!currentTimeZone || !this.timeZoneValue.equals(currentTimeZone)) {
        specs.push(
          UpdateRollupTimeZoneSpec.create(currentField.id(), currentTimeZone, this.timeZoneValue)
        );
      }
    }

    if (this.formattingValue !== undefined) {
      const currentFormatting = currentField.formatting();
      specs.push(
        UpdateRollupFormattingSpec.create(
          currentField.id(),
          currentFormatting,
          this.formattingValue
        )
      );
    }

    if (this.showAsValue !== undefined) {
      const currentShowAs = currentField.showAs();
      specs.push(UpdateRollupShowAsSpec.create(currentField.id(), currentShowAs, this.showAsValue));
    } else if (this.shouldClearShowAs) {
      const currentShowAs = currentField.showAs();
      if (currentShowAs !== undefined) {
        specs.push(UpdateRollupShowAsSpec.create(currentField.id(), currentShowAs, undefined));
      }
    }

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    if (this.configValue) {
      return ok([{ foreignTableId: this.configValue.foreignTableId() }]);
    }
    return ok([]);
  }
}

// ============ UpdateLinkFieldSpec ============

class UpdateLinkFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly configPatchValue: Readonly<Record<string, unknown>> | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined,
    private readonly foreignTablesValue: ReadonlyArray<Table>,
    private readonly hostTableValue: Table | undefined
  ) {}

  static create(
    input: {
      name?: string;
      options?: unknown;
      notNull?: unknown;
      unique?: unknown;
    },
    options?: {
      foreignTables?: ReadonlyArray<Table>;
      hostTable?: Table;
      replaceOptions?: boolean;
    }
  ): Result<UpdateLinkFieldSpec, DomainError> {
    const replaceOptions = options?.replaceOptions === true;
    const parseConfigPatch = (): Result<
      Readonly<Record<string, unknown>> | undefined,
      DomainError
    > => {
      if (input.options === undefined) return ok(undefined);
      if (!input.options || typeof input.options !== 'object' || Array.isArray(input.options)) {
        return err(domainError.validation({ message: 'Invalid LinkFieldConfig' }));
      }
      const patch = { ...(input.options as Record<string, unknown>) };
      if (replaceOptions) {
        const clearableKeys = ['filterByViewId', 'visibleFieldIds', 'filter'] as const;
        for (const key of clearableKeys) {
          if (!Object.prototype.hasOwnProperty.call(input.options, key)) {
            patch[key] = undefined;
          }
        }
      }
      return ok(patch);
    };

    return optional(input.name, FieldName.create).andThen((name) =>
      parseConfigPatch().andThen((configPatch) =>
        optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
          optional(input.unique, FieldUnique.create).map(
            (unique) =>
              new UpdateLinkFieldSpec(
                name,
                configPatch,
                notNull,
                unique,
                options?.foreignTables ?? [],
                options?.hostTable
              )
          )
        )
      )
    );
  }

  private deriveNextDbConfig(
    currentField: LinkField,
    nextConfig: LinkFieldConfig
  ): Result<LinkFieldConfig, DomainError> {
    const relationship = nextConfig.relationship().toString();
    const hostTable = this.hostTableValue;

    if (!hostTable) {
      return ok(nextConfig);
    }

    const baseId = hostTable.baseId();
    const fieldId = currentField.id();
    const symmetricFieldId = nextConfig.symmetricFieldId();

    const resolveJunctionTableName = (): Result<DbTableName, DomainError> => {
      const suffix = symmetricFieldId
        ? `${fieldId.toString()}_${symmetricFieldId.toString()}`
        : fieldId.toString();
      return DbTableName.rehydrate(`${baseId.toString()}.junction_${suffix}`);
    };

    const resolveForeignTableDbName = (): Result<DbTableName, DomainError> => {
      const foreignTable = this.foreignTablesValue.find((table) =>
        table.id().equals(nextConfig.foreignTableId())
      );
      if (!foreignTable) {
        return err(domainError.notFound({ message: 'Foreign table not found for link config' }));
      }
      return foreignTable.dbTableName();
    };

    const fkHostTableNameResult =
      relationship === 'manyMany'
        ? resolveJunctionTableName()
        : relationship === 'manyOne' || relationship === 'oneOne'
          ? hostTable.dbTableName()
          : relationship === 'oneMany'
            ? nextConfig.isOneWay()
              ? resolveJunctionTableName()
              : resolveForeignTableDbName()
            : err(domainError.validation({ message: 'Unsupported LinkRelationship' }));

    return fkHostTableNameResult.andThen((fkHostTableName) =>
      LinkFieldConfig.buildDbConfig({
        fkHostTableName,
        relationship: nextConfig.relationship(),
        fieldId,
        symmetricFieldId,
        isOneWay: nextConfig.isOneWay(),
      }).andThen((dbConfig) => nextConfig.withDbConfig(dbConfig))
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof LinkField)) {
      return err(domainError.validation({ message: 'Expected LinkField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.configPatchValue !== undefined) {
      const currentConfig = currentField.config();
      const currentConfigDtoResult = currentConfig.toDto();
      if (currentConfigDtoResult.isErr()) return err(currentConfigDtoResult.error);
      const currentConfigDto = currentConfigDtoResult.value;

      const mergedConfig: Record<string, unknown> = { ...currentConfigDto };
      // Strip dbConfig so ensureDbConfig() can regenerate it when the relationship
      // type changes (e.g., manyMany↔oneMany twoWay switches between junction table
      // and FK column storage). The non-needsNewDbConfig path in
      // UpdateLinkConfigSpec.mutate() restores the previous dbConfig via withDbConfig().
      delete mergedConfig.fkHostTableName;
      delete mergedConfig.selfKeyName;
      delete mergedConfig.foreignKeyName;
      const dbConfigKeys = new Set(['fkHostTableName', 'selfKeyName', 'foreignKeyName']);
      for (const [key, value] of Object.entries(this.configPatchValue)) {
        // Never accept external dbConfig patches. These values must be generated/preserved by domain logic.
        if (dbConfigKeys.has(key)) continue;
        mergedConfig[key] = value;
      }

      const hasLookupFieldIdPatch = Object.prototype.hasOwnProperty.call(
        this.configPatchValue,
        'lookupFieldId'
      );
      const requestedForeignTableId =
        typeof mergedConfig.foreignTableId === 'string' ? mergedConfig.foreignTableId : undefined;
      const isForeignTableChanging =
        requestedForeignTableId !== undefined &&
        requestedForeignTableId !== currentConfigDto.foreignTableId;

      // Keep v1-compatible behavior: when foreign table changes but lookupFieldId is not
      // explicitly provided, default to the new foreign table primary field.
      if (isForeignTableChanging && !hasLookupFieldIdPatch) {
        const foreignTable = this.foreignTablesValue.find(
          (table) => table.id().toString() === requestedForeignTableId
        );
        if (foreignTable) {
          mergedConfig.lookupFieldId = foreignTable.primaryFieldId().toString();
        }
      }

      // Note: we intentionally do NOT clear symmetricFieldId from the config
      // when converting to oneWay. The symmetricFieldId is an internal implementation
      // detail used for junction table naming (junction_{fieldId}_{symmetricFieldId}).
      // Clearing it would cause deriveNextDbConfig() to produce the wrong junction
      // table name. The API response layer (FieldToDtoVisitor) handles stripping
      // symmetricFieldId for oneWay links in API responses.

      // Check if converting from oneWay to twoWay
      const initialConfigResult = LinkFieldConfig.create(mergedConfig);
      if (initialConfigResult.isErr()) return err(initialConfigResult.error);
      const initialConfig = initialConfigResult.value;
      const isOneWayToTwoWay = currentConfig.isOneWay() && !initialConfig.isOneWay();

      let effectiveConfig: LinkFieldConfig;

      if (isOneWayToTwoWay && !initialConfig.symmetricFieldId()) {
        // Generate a new symmetricFieldId for twoWay conversion
        const symmetricFieldIdResult = FieldId.generate();
        if (symmetricFieldIdResult.isErr()) {
          return err(symmetricFieldIdResult.error);
        }
        const symmetricFieldId = symmetricFieldIdResult.value;

        // Create a new config with the symmetricFieldId
        const configWithSymmetricId = initialConfig.withSymmetricFieldId(symmetricFieldId);
        if (configWithSymmetricId.isErr()) {
          return err(configWithSymmetricId.error);
        }

        effectiveConfig = configWithSymmetricId.value;
      } else {
        effectiveConfig = initialConfig;
      }

      const relationshipChanging = !currentConfig
        .relationship()
        .equals(effectiveConfig.relationship());
      // Recompute dbConfig when the storage mechanism changes.
      // Storage type: junction table for manyMany or (oneMany && oneWay);
      //               FK column for manyOne, oneOne, or oneMany twoWay.
      const usesJunction = (config: LinkFieldConfig): boolean => {
        const rel = config.relationship().toString();
        return rel === 'manyMany' || (rel === 'oneMany' && config.isOneWay());
      };
      const isStorageTypeChanging = usesJunction(currentConfig) !== usesJunction(effectiveConfig);
      const isOneWayChanging = currentConfig.isOneWay() !== effectiveConfig.isOneWay();
      const shouldRecomputeDbConfig =
        isForeignTableChanging ||
        (relationshipChanging && !currentConfig.isOneWay() && !effectiveConfig.isOneWay()) ||
        isStorageTypeChanging ||
        // OneWay↔TwoWay changes the junction table naming (oneWay uses a generated
        // symmetricFieldId, twoWay uses the actual symmetric field's ID).
        // For junction-based relationships (manyMany, oneMany oneWay), this means
        // the junction table name changes and dbConfig must be recomputed.
        // For FK-based relationships with relationship type change,
        // the FK host table may also change.
        isOneWayChanging;
      if (shouldRecomputeDbConfig) {
        const withDerivedDbConfigResult = this.deriveNextDbConfig(currentField, effectiveConfig);
        if (withDerivedDbConfigResult.isErr()) return err(withDerivedDbConfigResult.error);
        effectiveConfig = withDerivedDbConfigResult.value;
      }

      if (isForeignTableChanging) {
        const nextFieldResult = LinkField.create({
          id: currentField.id(),
          name: currentField.name(),
          config: effectiveConfig,
          meta: currentField.meta(),
        });
        if (nextFieldResult.isErr()) return err(nextFieldResult.error);
        const nextField = nextFieldResult.value;

        const dbFieldNameResult = currentField.dbFieldName();
        if (dbFieldNameResult.isOk()) {
          const setDbFieldNameResult = nextField.setDbFieldName(dbFieldNameResult.value);
          if (setDbFieldNameResult.isErr()) return err(setDbFieldNameResult.error);
        }

        // Changing foreign table requires physical schema migration, not metadata-only update.
        specs.push(TableUpdateFieldTypeSpec.create(currentField, nextField));
      } else {
        specs.push(UpdateLinkConfigSpec.create(currentField.id(), currentConfig, effectiveConfig));
      }

      // Emit UpdateLinkRelationshipSpec when relationship type, storage type,
      // or oneWay flag changes (which may change junction table naming).
      // For isOneWayChanging without storage or relationship change, we only need
      // the spec when the junction table name changes (junction-based storage).
      const needsRelationshipSpec =
        !isForeignTableChanging &&
        (relationshipChanging ||
          isStorageTypeChanging ||
          (isOneWayChanging && usesJunction(currentConfig)));
      if (needsRelationshipSpec) {
        const dbFieldNameResult = currentField.dbFieldName();
        if (dbFieldNameResult.isOk()) {
          specs.push(
            UpdateLinkRelationshipSpec.create({
              fieldId: currentField.id(),
              dbFieldName: dbFieldNameResult.value,
              previousConfig: currentConfig,
              nextConfig: effectiveConfig,
            })
          );
        }
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const foreignTableIdRaw = this.configPatchValue?.foreignTableId;
    if (typeof foreignTableIdRaw === 'string') {
      return TableId.create(foreignTableIdRaw).andThen((foreignTableId) => {
        const baseIdRaw = this.configPatchValue?.baseId;
        if (typeof baseIdRaw !== 'string') {
          return ok([{ foreignTableId }]);
        }
        return BaseId.create(baseIdRaw).map((baseId) => [{ foreignTableId, baseId }]);
      });
    }
    return ok([]);
  }
}

// ============ UpdateLookupFieldSpec ============

class UpdateLookupFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly lookupOptionsPatchValue:
      | {
          linkFieldId?: string;
          foreignTableId?: string;
          lookupFieldId?: string;
          filter?: unknown;
          sort?: unknown;
          limit?: number;
        }
      | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined,
    private readonly shouldClearShowAs: boolean,
    private readonly foreignTablesValue: ReadonlyArray<Table>
  ) {}

  static create(
    input: {
      name?: string;
      options?: {
        linkFieldId?: string;
        foreignTableId?: string;
        lookupFieldId?: string;
        filter?: unknown;
        sort?: unknown;
        limit?: number;
        showAs?: unknown;
      };
      notNull?: unknown;
      unique?: unknown;
    },
    context?: {
      foreignTables?: ReadonlyArray<Table>;
      replaceOptions?: boolean;
    }
  ): Result<UpdateLookupFieldSpec, DomainError> {
    const replaceOptions = context?.replaceOptions === true;
    const shouldClearShowAs =
      input.options !== undefined &&
      ((Object.prototype.hasOwnProperty.call(input.options, 'showAs') &&
        input.options.showAs === null) ||
        (replaceOptions && !Object.prototype.hasOwnProperty.call(input.options, 'showAs')));
    return optional(input.name, FieldName.create).andThen((name) => {
      const optionsPatch = input.options
        ? {
            ...(Object.prototype.hasOwnProperty.call(input.options, 'linkFieldId')
              ? { linkFieldId: input.options.linkFieldId }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(input.options, 'foreignTableId')
              ? { foreignTableId: input.options.foreignTableId }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(input.options, 'lookupFieldId')
              ? { lookupFieldId: input.options.lookupFieldId }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(input.options, 'filter') || replaceOptions
              ? { filter: input.options.filter }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(input.options, 'sort') || replaceOptions
              ? { sort: input.options.sort }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(input.options, 'limit') || replaceOptions
              ? { limit: input.options.limit }
              : {}),
          }
        : undefined;

      return optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
        optional(input.unique, FieldUnique.create).map(
          (unique) =>
            new UpdateLookupFieldSpec(
              name,
              optionsPatch,
              notNull,
              unique,
              shouldClearShowAs,
              context?.foreignTables ?? []
            )
        )
      );
    });
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof LookupField)) {
      return err(domainError.validation({ message: 'Expected LookupField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    const currentOptions = currentField.lookupOptions();
    if (this.lookupOptionsPatchValue !== undefined) {
      const mergedOptionsDto: Record<string, unknown> = {
        ...currentOptions.toDto(),
      };
      for (const [key, value] of Object.entries(this.lookupOptionsPatchValue)) {
        mergedOptionsDto[key] = value;
      }

      const hasLookupFieldIdPatch = Object.prototype.hasOwnProperty.call(
        this.lookupOptionsPatchValue,
        'lookupFieldId'
      );
      const requestedForeignTableId =
        typeof mergedOptionsDto.foreignTableId === 'string'
          ? mergedOptionsDto.foreignTableId
          : undefined;
      const isForeignTableChanging =
        requestedForeignTableId !== undefined &&
        requestedForeignTableId !== currentOptions.foreignTableId().toString();

      // Keep v1-compatible behavior: when foreign table changes but lookupFieldId is not
      // explicitly provided, default to the new foreign table primary field.
      if (isForeignTableChanging && !hasLookupFieldIdPatch) {
        const foreignTable = this.foreignTablesValue.find(
          (table) => table.id().toString() === requestedForeignTableId
        );
        if (foreignTable) {
          mergedOptionsDto.lookupFieldId = foreignTable.primaryFieldId().toString();
        }
      }

      const nextOptionsResult = LookupOptions.create(mergedOptionsDto);
      if (nextOptionsResult.isErr()) {
        return err(nextOptionsResult.error);
      }
      const nextOptions = nextOptionsResult.value;

      if (!nextOptions.equals(currentOptions) || this.shouldClearShowAs) {
        specs.push(UpdateLookupOptionsSpec.create(currentField.id(), currentOptions, nextOptions));
      }
    } else if (this.shouldClearShowAs) {
      // Force a lookup options update to recreate the pending lookup field,
      // which re-resolves the inner field from the foreign table without showAs.
      specs.push(UpdateLookupOptionsSpec.create(currentField.id(), currentOptions, currentOptions));
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const foreignTableIdRaw = this.lookupOptionsPatchValue?.foreignTableId;
    if (typeof foreignTableIdRaw === 'string') {
      return TableId.create(foreignTableIdRaw).map((foreignTableId) => [{ foreignTableId }]);
    }
    return ok([]);
  }
}

// ============ UpdateUserFieldSpec ============

class UpdateUserFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly multiplicityValue: UserMultiplicity | undefined,
    private readonly notificationValue: UserNotification | undefined,
    private readonly defaultValueValue: UserDefaultValue | undefined,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      isMultiple?: unknown;
      shouldNotify?: unknown;
      defaultValue?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateUserFieldSpec, DomainError> {
    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.isMultiple, UserMultiplicity.create).andThen((multiplicity) =>
        optional(input.options?.shouldNotify, UserNotification.create).andThen((notification) =>
          optional(input.options?.defaultValue, UserDefaultValue.create).andThen((defaultValue) =>
            optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
              optional(input.unique, FieldUnique.create).map(
                (unique) =>
                  new UpdateUserFieldSpec(
                    name,
                    multiplicity,
                    notification,
                    defaultValue,
                    notNull,
                    unique
                  )
              )
            )
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof UserField)) {
      return err(domainError.validation({ message: 'Expected UserField' }));
    }

    const dbFieldNameResult = resolveDbFieldName(currentField);
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);
    const dbFieldName = dbFieldNameResult.value;

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.multiplicityValue !== undefined) {
      const currentMultiplicity = currentField.multiplicity();
      if (!this.multiplicityValue.equals(currentMultiplicity)) {
        specs.push(
          UpdateUserMultiplicitySpec.create(
            currentField.id(),
            dbFieldName,
            currentMultiplicity,
            this.multiplicityValue
          )
        );
      }
    }

    if (this.notificationValue !== undefined) {
      const currentNotification = currentField.notification();
      if (!this.notificationValue.equals(currentNotification)) {
        specs.push(
          UpdateUserNotificationSpec.create(
            currentField.id(),
            currentNotification,
            this.notificationValue
          )
        );
      }
    }

    if (this.defaultValueValue !== undefined) {
      const currentDefault = currentField.defaultValue();
      if (!currentDefault || !this.defaultValueValue.equals(currentDefault)) {
        specs.push(
          UpdateUserDefaultValueSpec.create(
            currentField.id(),
            currentDefault,
            this.defaultValueValue
          )
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

// ============ UpdateButtonFieldSpec ============

class UpdateButtonFieldSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly nameValue: FieldName | undefined,
    private readonly labelValue: ButtonLabel | undefined,
    private readonly colorValue: FieldColor | undefined,
    private readonly maxCountValue: ButtonMaxCount | undefined,
    private readonly shouldClearMaxCount: boolean,
    private readonly workflowClearable: ClearableResult<ButtonWorkflow | undefined>,
    private readonly notNullValue: FieldNotNull | undefined,
    private readonly uniqueValue: FieldUnique | undefined
  ) {}

  static create(input: {
    name?: string;
    options?: {
      label?: unknown;
      color?: unknown;
      maxCount?: unknown;
      workflow?: unknown;
    };
    notNull?: unknown;
    unique?: unknown;
  }): Result<UpdateButtonFieldSpec, DomainError> {
    const maxCountWasProvided =
      input.options != null &&
      typeof input.options === 'object' &&
      Object.prototype.hasOwnProperty.call(input.options, 'maxCount');

    const workflowWasProvided =
      input.options != null &&
      typeof input.options === 'object' &&
      Object.prototype.hasOwnProperty.call(input.options, 'workflow');

    return optional(input.name, FieldName.create).andThen((name) =>
      optional(input.options?.label, ButtonLabel.create).andThen((label) =>
        optional(input.options?.color, FieldColor.create).andThen((color) =>
          optional(input.options?.maxCount, ButtonMaxCount.create).andThen((maxCount) =>
            clearable(input.options?.workflow, workflowWasProvided, ButtonWorkflow.create).andThen(
              (workflowResult) =>
                optional(input.notNull, FieldNotNull.create).andThen((notNull) =>
                  optional(input.unique, FieldUnique.create).map(
                    (unique) =>
                      new UpdateButtonFieldSpec(
                        name,
                        label,
                        color,
                        maxCount,
                        !maxCountWasProvided,
                        workflowResult,
                        notNull,
                        unique
                      )
                  )
                )
            )
          )
        )
      )
    );
  }

  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    if (!(currentField instanceof ButtonField)) {
      return err(domainError.validation({ message: 'Expected ButtonField' }));
    }

    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    if (this.nameValue && !this.nameValue.equals(currentField.name())) {
      specs.push(
        TableUpdateFieldNameSpec.create(currentField.id(), currentField.name(), this.nameValue)
      );
    }

    if (this.labelValue !== undefined) {
      const currentLabel = currentField.label();
      if (!currentLabel || !this.labelValue.equals(currentLabel)) {
        specs.push(UpdateButtonLabelSpec.create(currentField.id(), currentLabel, this.labelValue));
      }
    }

    if (this.colorValue !== undefined) {
      const currentColor = currentField.color();
      if (!currentColor || !this.colorValue.equals(currentColor)) {
        specs.push(UpdateButtonColorSpec.create(currentField.id(), currentColor, this.colorValue));
      }
    }

    if (this.maxCountValue !== undefined) {
      const currentMaxCount = currentField.maxCount();
      if (!currentMaxCount || !this.maxCountValue.equals(currentMaxCount)) {
        specs.push(
          UpdateButtonMaxCountSpec.create(currentField.id(), currentMaxCount, this.maxCountValue)
        );
      }
    } else if (this.shouldClearMaxCount) {
      const currentMaxCount = currentField.maxCount();
      if (currentMaxCount !== undefined) {
        specs.push(UpdateButtonMaxCountSpec.create(currentField.id(), currentMaxCount, undefined));
      }
    }

    if (this.workflowClearable.shouldClear) {
      // Workflow explicitly set to null - clear it
      const currentWorkflow = currentField.workflow();
      if (currentWorkflow !== undefined) {
        specs.push(UpdateButtonWorkflowSpec.create(currentField.id(), currentWorkflow, undefined));
      }
    } else if (this.workflowClearable.value !== undefined) {
      const currentWorkflow = currentField.workflow();
      if (!currentWorkflow || !this.workflowClearable.value.equals(currentWorkflow)) {
        specs.push(
          UpdateButtonWorkflowSpec.create(
            currentField.id(),
            currentWorkflow,
            this.workflowClearable.value
          )
        );
      }
    }

    const constraintsSpec = buildConstraintsSpec(currentField, this.notNullValue, this.uniqueValue);
    if (constraintsSpec) specs.push(constraintsSpec);

    return ok(specs);
  }

  createField(): Result<Field, DomainError> {
    return err(domainError.validation({ message: 'Not a type conversion' }));
  }

  isTypeConversion(): boolean {
    return false;
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }
}

import { parseTableFieldSpec } from './TableFieldSpecs';
import { TypeConversionUpdateSpec } from './TypeConversionUpdateSpec';

// ============ parseUpdateFieldSpec function ============

/**
 * Parse an update input and create the appropriate UpdateXFieldSpec.
 *
 * @param currentField - The existing field being updated
 * @param input - The update input containing changed properties
 * @returns The appropriate UpdateXFieldSpec for the field type
 */
export const parseUpdateFieldSpec = (
  currentField: Field,
  input: {
    type?: string;
    name?: string;
    description?: string | null;
    options?: unknown;
    config?: unknown;
    notNull?: unknown;
    unique?: unknown;
    max?: unknown;
    cellValueType?: string;
    isMultipleCellValue?: boolean;
    replaceOptions?: boolean;
  },
  options?: {
    hostTable?: Table;
    foreignTables?: ReadonlyArray<Table>;
  }
): Result<IUpdateTableFieldSpec, DomainError> => {
  const fieldType = currentField.type().toString();

  // Check if type is changing (type conversion)
  if (input.type && input.type !== fieldType) {
    return parseTypeConversion(currentField, input, options);
  }

  // Same type update: dispatch to type-specific UpdateSpec
  return match(fieldType)
    .with('singleLineText', () =>
      UpdateSingleLineTextFieldSpec.create(
        input as Parameters<typeof UpdateSingleLineTextFieldSpec.create>[0]
      )
    )
    .with('longText', () =>
      UpdateLongTextFieldSpec.create(input as Parameters<typeof UpdateLongTextFieldSpec.create>[0])
    )
    .with('number', () =>
      UpdateNumberFieldSpec.create(input as Parameters<typeof UpdateNumberFieldSpec.create>[0])
    )
    .with('rating', () =>
      UpdateRatingFieldSpec.create(input as Parameters<typeof UpdateRatingFieldSpec.create>[0])
    )
    .with('date', () =>
      UpdateDateFieldSpec.create(input as Parameters<typeof UpdateDateFieldSpec.create>[0])
    )
    .with('createdTime', () =>
      UpdateCreatedTimeFieldSpec.create(
        input as Parameters<typeof UpdateCreatedTimeFieldSpec.create>[0]
      )
    )
    .with('lastModifiedTime', () =>
      UpdateLastModifiedTimeFieldSpec.create(
        input as Parameters<typeof UpdateLastModifiedTimeFieldSpec.create>[0]
      )
    )
    .with('checkbox', () =>
      UpdateCheckboxFieldSpec.create(input as Parameters<typeof UpdateCheckboxFieldSpec.create>[0])
    )
    .with('attachment', () =>
      UpdateAttachmentFieldSpec.create(
        input as Parameters<typeof UpdateAttachmentFieldSpec.create>[0]
      )
    )
    .with('createdBy', () =>
      UpdateCreatedByFieldSpec.create(
        input as Parameters<typeof UpdateCreatedByFieldSpec.create>[0]
      )
    )
    .with('lastModifiedBy', () =>
      UpdateLastModifiedByFieldSpec.create(
        input as Parameters<typeof UpdateLastModifiedByFieldSpec.create>[0]
      )
    )
    .with('autoNumber', () =>
      UpdateAutoNumberFieldSpec.create(
        input as Parameters<typeof UpdateAutoNumberFieldSpec.create>[0]
      )
    )
    .with('singleSelect', () =>
      UpdateSingleSelectFieldSpec.create(
        input as Parameters<typeof UpdateSingleSelectFieldSpec.create>[0]
      )
    )
    .with('multipleSelect', () =>
      UpdateMultipleSelectFieldSpec.create(
        input as Parameters<typeof UpdateMultipleSelectFieldSpec.create>[0]
      )
    )
    .with('formula', () =>
      UpdateFormulaFieldSpec.create(input as Parameters<typeof UpdateFormulaFieldSpec.create>[0])
    )
    .with('rollup', () =>
      UpdateRollupFieldSpec.create(input as Parameters<typeof UpdateRollupFieldSpec.create>[0])
    )
    .with('link', () =>
      UpdateLinkFieldSpec.create(input as Parameters<typeof UpdateLinkFieldSpec.create>[0], {
        foreignTables: options?.foreignTables,
        hostTable: options?.hostTable,
        replaceOptions: input.replaceOptions === true,
      })
    )
    .with('lookup', () =>
      UpdateLookupFieldSpec.create(input as Parameters<typeof UpdateLookupFieldSpec.create>[0], {
        foreignTables: options?.foreignTables,
        replaceOptions: input.replaceOptions === true,
      })
    )
    .with('conditionalLookup', () =>
      UpdateConditionalLookupFieldSpec.create(
        input as Parameters<typeof UpdateConditionalLookupFieldSpec.create>[0],
        {
          foreignTables: options?.foreignTables,
        }
      )
    )
    .with('conditionalRollup', () =>
      UpdateConditionalRollupFieldSpec.create(
        input as Parameters<typeof UpdateConditionalRollupFieldSpec.create>[0],
        { foreignTables: options?.foreignTables }
      )
    )
    .with('user', () =>
      UpdateUserFieldSpec.create(input as Parameters<typeof UpdateUserFieldSpec.create>[0])
    )
    .with('button', () =>
      UpdateButtonFieldSpec.create(input as Parameters<typeof UpdateButtonFieldSpec.create>[0])
    )
    .otherwise(() =>
      err(domainError.validation({ message: `Update not supported for field type: ${fieldType}` }))
    );
};

export const buildUpdateFieldSpecs = (
  currentField: Field,
  input: {
    type?: string;
    name?: string;
    description?: string | null;
    dbFieldName?: string;
    notNull?: unknown;
    unique?: unknown;
    options?: unknown;
    config?: unknown;
    max?: unknown;
    cellValueType?: string;
    isMultipleCellValue?: boolean;
    aiConfig?: unknown;
    replaceOptions?: boolean;
  },
  options?: {
    hostTable?: Table;
    foreignTables?: ReadonlyArray<Table>;
  }
): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> => {
  const updateSpecResult = parseUpdateFieldSpec(currentField, input, options);
  if (updateSpecResult.isErr()) {
    return err(updateSpecResult.error);
  }
  const updateSpec = updateSpecResult.value;

  const specsResult = updateSpec.isTypeConversion()
    ? ensureDbFieldName(currentField).andThen(() =>
        resolveDbFieldName(currentField)
          .andThen((stableDbFieldName) => stableDbFieldName.value())
          .andThen((stableDbFieldName) =>
            updateSpec
              .createField({
                baseId: options?.hostTable?.baseId(),
                tableId: options?.hostTable?.id(),
              })
              .andThen((newField) =>
                ensureDbFieldName(newField, stableDbFieldName).map(() => [
                  TableUpdateFieldTypeSpec.create(currentField, newField),
                ])
              )
          )
      )
    : updateSpec.buildSpecs(currentField);
  if (specsResult.isErr()) {
    return err(specsResult.error);
  }

  const specs = [...specsResult.value];

  if (input.dbFieldName) {
    const currentDbFieldNameResult = currentField.dbFieldName();
    if (currentDbFieldNameResult.isOk()) {
      const currentDbFieldNameStr = currentDbFieldNameResult.value.value();
      if (currentDbFieldNameStr.isOk() && currentDbFieldNameStr.value !== input.dbFieldName) {
        const nextDbFieldNameResult = DbFieldName.rehydrate(input.dbFieldName);
        if (nextDbFieldNameResult.isErr()) return err(nextDbFieldNameResult.error);
        specs.push(
          TableUpdateFieldDbFieldNameSpec.create(
            currentField.id(),
            currentDbFieldNameResult.value,
            nextDbFieldNameResult.value
          )
        );
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'aiConfig')) {
    specs.push(
      TableUpdateFieldAiConfigSpec.create(currentField.id(), null, input.aiConfig ?? null)
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, 'description')) {
    const nextDescription = input.description ?? null;
    if (currentField.description() !== nextDescription) {
      specs.push(
        TableUpdateFieldDescriptionSpec.create(
          currentField.id(),
          currentField.description(),
          nextDescription
        )
      );
    }
  }

  return ok(specs);
};

/**
 * Parse type conversion and create a TypeConversionUpdateSpec.
 *
 * @param currentField - The existing field being converted
 * @param input - The update input containing the new type and configuration
 */
const parseTypeConversion = (
  currentField: Field,
  input: {
    type?: string;
    name?: string;
    description?: string | null;
    options?: unknown;
    config?: unknown;
    notNull?: unknown;
    unique?: unknown;
    max?: unknown;
    cellValueType?: string;
    isMultipleCellValue?: boolean;
  },
  options?: {
    hostTable?: Table;
    foreignTables?: ReadonlyArray<Table>;
  }
): Result<IUpdateTableFieldSpec, DomainError> => {
  if (!input.type) {
    return err(domainError.validation({ message: 'Type conversion requires a type' }));
  }

  // Use existing field name if not provided
  const fieldName = input.name ?? currentField.name().toString();

  // Build the input for parseTableFieldSpec
  // Keep the same field ID so the conversion updates the existing field
  const createFieldInput: Record<string, unknown> = {
    type: input.type,
    id: currentField.id().toString(),
    name: fieldName,
    description: Object.prototype.hasOwnProperty.call(input, 'description')
      ? input.description ?? null
      : currentField.description(),
    options: input.options,
    config: input.config,
    notNull: input.notNull,
    unique: input.unique,
    max: input.max,
    cellValueType: input.cellValueType,
    isMultipleCellValue: input.isMultipleCellValue,
  };

  if (currentField instanceof LookupField && input.options && typeof input.options === 'object') {
    const mergedLookupOptions: Record<string, unknown> = {
      ...currentField.lookupOptionsDto(),
      ...(input.options as Record<string, unknown>),
    };

    const hasLookupFieldIdPatch = Object.prototype.hasOwnProperty.call(
      input.options as Record<string, unknown>,
      'lookupFieldId'
    );
    const requestedForeignTableId =
      typeof mergedLookupOptions.foreignTableId === 'string'
        ? mergedLookupOptions.foreignTableId
        : undefined;
    const isForeignTableChanging =
      requestedForeignTableId !== undefined &&
      requestedForeignTableId !== currentField.foreignTableId().toString();

    if (isForeignTableChanging && !hasLookupFieldIdPatch) {
      const foreignTable = options?.foreignTables?.find(
        (table) => table.id().toString() === requestedForeignTableId
      );
      if (foreignTable) {
        mergedLookupOptions.lookupFieldId = foreignTable.primaryFieldId().toString();
      }
    }

    createFieldInput.options = mergedLookupOptions;
  }

  if (input.type === 'link' && input.options && typeof input.options === 'object') {
    const linkOptions = { ...(input.options as Record<string, unknown>) };
    if (linkOptions.lookupFieldId == null && typeof linkOptions.foreignTableId === 'string') {
      const foreignTable = options?.foreignTables?.find(
        (table) => table.id().toString() === linkOptions.foreignTableId
      );
      if (foreignTable) {
        linkOptions.lookupFieldId = foreignTable.primaryFieldId().toString();
      }
    }
    createFieldInput.options = linkOptions;
  }

  const deriveLookupMultiplicityForTypeConversion = (): Result<
    boolean | undefined,
    DomainError
  > => {
    if (input.type !== 'lookup' || input.isMultipleCellValue != null) {
      return ok(undefined);
    }

    const hostTable = options?.hostTable;
    if (!hostTable) {
      return ok(undefined);
    }

    const rawOptions = createFieldInput.options;
    if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) {
      return ok(undefined);
    }

    const linkFieldIdRaw = (rawOptions as Record<string, unknown>).linkFieldId;
    if (typeof linkFieldIdRaw !== 'string') {
      return ok(undefined);
    }

    const linkFieldIdResult = FieldId.create(linkFieldIdRaw);
    if (linkFieldIdResult.isErr()) {
      return ok(undefined);
    }

    const linkFieldResult = hostTable.getField((field) =>
      field.id().equals(linkFieldIdResult.value)
    );
    if (linkFieldResult.isErr()) {
      return ok(undefined);
    }

    if (!(linkFieldResult.value instanceof LinkField)) {
      return ok(undefined);
    }

    return ok(linkFieldResult.value.isMultipleValue());
  };

  const derivedLookupMultiplicityResult = deriveLookupMultiplicityForTypeConversion();
  if (derivedLookupMultiplicityResult.isErr()) return err(derivedLookupMultiplicityResult.error);
  if (derivedLookupMultiplicityResult.value != null) {
    createFieldInput.isMultipleCellValue = derivedLookupMultiplicityResult.value;
  }

  const deriveComputedResultTypeForTypeConversion = (): Result<
    { cellValueType: string; isMultipleCellValue: boolean } | undefined,
    DomainError
  > => {
    if (
      (input.type !== 'rollup' && input.type !== 'conditionalRollup') ||
      input.cellValueType != null ||
      input.isMultipleCellValue != null
    ) {
      return ok(undefined);
    }

    if (!input.options || typeof input.options !== 'object' || Array.isArray(input.options)) {
      return err(
        domainError.validation({
          message: `Cannot derive ${input.type} result type: options are required`,
        })
      );
    }
    if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) {
      return err(
        domainError.validation({
          message: `Cannot derive ${input.type} result type: config is required`,
        })
      );
    }

    const expressionRaw = (input.options as Record<string, unknown>).expression;
    if (typeof expressionRaw !== 'string') {
      return err(
        domainError.validation({
          message: `Cannot derive ${input.type} result type: options.expression is required`,
        })
      );
    }

    const expressionResult = RollupExpression.create(expressionRaw);
    if (expressionResult.isErr()) return err(expressionResult.error);

    const configResult =
      input.type === 'rollup'
        ? RollupFieldConfig.create(input.config)
        : ConditionalRollupConfig.create(input.config);
    if (configResult.isErr()) return err(configResult.error);

    const foreignTables = options?.foreignTables;
    if (!foreignTables || foreignTables.length === 0) {
      return err(
        domainError.invariant({
          message: `Cannot derive ${input.type} result type: foreign tables not loaded`,
        })
      );
    }

    const foreignTable = foreignTables.find((table) =>
      table.id().equals(configResult.value.foreignTableId())
    );
    if (!foreignTable) {
      return err(
        domainError.validation({
          message: `Cannot derive ${input.type} result type: foreign table not found`,
        })
      );
    }

    const lookupFieldResult = ForeignTable.from(foreignTable).fieldById(
      configResult.value.lookupFieldId()
    );
    if (lookupFieldResult.isErr()) {
      return err(
        domainError.validation({
          message: `Cannot derive ${input.type} result type: lookup field not found`,
        })
      );
    }

    const valuesTypeResult = lookupFieldResult.value.accept(new FieldValueTypeVisitor());
    if (valuesTypeResult.isErr()) return err(valuesTypeResult.error);

    const parsedTypeResult = expressionResult.value.getParsedValueType({
      cellValueType: valuesTypeResult.value.cellValueType,
      isMultipleCellValue: valuesTypeResult.value.isMultipleCellValue,
    });
    if (parsedTypeResult.isErr()) return err(parsedTypeResult.error);

    return ok({
      cellValueType: parsedTypeResult.value.cellValueType.toString(),
      isMultipleCellValue: parsedTypeResult.value.isMultipleCellValue.toBoolean(),
    });
  };

  const derivedResultTypeResult = deriveComputedResultTypeForTypeConversion();
  if (derivedResultTypeResult.isErr()) return err(derivedResultTypeResult.error);
  if (derivedResultTypeResult.value) {
    createFieldInput.cellValueType = derivedResultTypeResult.value.cellValueType;
    createFieldInput.isMultipleCellValue = derivedResultTypeResult.value.isMultipleCellValue;
  }

  // Parse as a create spec
  const createSpecResult = parseTableFieldSpec(
    createFieldInput as Parameters<typeof parseTableFieldSpec>[0],
    { isPrimary: false } // Type conversion doesn't change primary status
  );

  if (createSpecResult.isErr()) {
    return err(createSpecResult.error);
  }

  // Wrap in TypeConversionUpdateSpec
  return ok(TypeConversionUpdateSpec.create(currentField, createSpecResult.value));
};
