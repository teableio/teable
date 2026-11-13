import dayjs from 'dayjs';
import { err, ok, Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { AttachmentField } from '../../domain/table/fields/types/AttachmentField';
import type { AutoNumberField } from '../../domain/table/fields/types/AutoNumberField';
import type { ButtonField } from '../../domain/table/fields/types/ButtonField';
import type { CheckboxField } from '../../domain/table/fields/types/CheckboxField';
import type { ConditionalLookupField } from '../../domain/table/fields/types/ConditionalLookupField';
import type { ConditionalRollupField } from '../../domain/table/fields/types/ConditionalRollupField';
import type { CreatedByField } from '../../domain/table/fields/types/CreatedByField';
import type { CreatedTimeField } from '../../domain/table/fields/types/CreatedTimeField';
import type { DateField } from '../../domain/table/fields/types/DateField';
import { DateTimeFormatting } from '../../domain/table/fields/types/DateTimeFormatting';
import type { FormulaField } from '../../domain/table/fields/types/FormulaField';
import type { LastModifiedByField } from '../../domain/table/fields/types/LastModifiedByField';
import type { LastModifiedTimeField } from '../../domain/table/fields/types/LastModifiedTimeField';
import type { LinkField } from '../../domain/table/fields/types/LinkField';
import type { LongTextField } from '../../domain/table/fields/types/LongTextField';
import type { LookupField } from '../../domain/table/fields/types/LookupField';
import type { MultipleSelectField } from '../../domain/table/fields/types/MultipleSelectField';
import type { NumberField } from '../../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../../domain/table/fields/types/NumberFormatting';
import type { RatingField } from '../../domain/table/fields/types/RatingField';
import type { RollupField } from '../../domain/table/fields/types/RollupField';
import type { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import type { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import type { UserField } from '../../domain/table/fields/types/UserField';
import { AbstractFieldVisitor } from '../../domain/table/fields/visitors/AbstractFieldVisitor';
import {
  dateDisplayPattern,
  prepareNumberValueRenderer,
  renderDateValue,
} from './cellValueFormatting';

/**
 * Prepared display serialization, not clipboard CSV serialization.
 * Historical text/select scalars are deliberately not coerced. Consumers decide whether
 * an invalid value should be displayed structurally or should prevent an equality shortcut.
 */
export type FieldDisplayValueFormatter = (value: unknown) => Result<unknown, DomainError>;

const invalidDisplayValue = () =>
  domainError.validation({
    code: 'formatting.invalid_cell_value',
    message: 'Invalid display value',
  });

const stringifyValue = Result.fromThrowable(
  (value: unknown) => (value == null ? '' : String(value)),
  invalidDisplayValue
);

const withMultipleValues = (
  formatOne: FieldDisplayValueFormatter,
  multiple: boolean,
  requireArray = false,
  separator = ', '
): FieldDisplayValueFormatter => {
  const joinValues = Result.fromThrowable(
    (values: unknown[]) => values.join(separator),
    invalidDisplayValue
  );
  return (value) => {
    if (value == null) return ok('');
    if (!multiple) return formatOne(value);
    if (!Array.isArray(value)) return requireArray ? err(invalidDisplayValue()) : formatOne(value);
    const values: unknown[] = [];
    for (const item of value) {
      const formatted = formatOne(item);
      if (formatted.isErr()) return err(formatted.error);
      values.push(formatted.value);
    }
    return joinValues(values);
  };
};

const numberFormatter = (formatting: NumberFormatting): FieldDisplayValueFormatter => {
  const render = prepareNumberValueRenderer(formatting);
  return Result.fromThrowable(
    (value: unknown) => (value == null ? '' : render(Number(value))),
    invalidDisplayValue
  );
};

const dateFormatter = (formatting: DateTimeFormatting): FieldDisplayValueFormatter => {
  const pattern = dateDisplayPattern(formatting);
  const timeZone = formatting.timeZone().toString();
  const render = Result.fromThrowable((value: unknown) => {
    // Unlike clipboard text, stored date values are parsed with their original type.
    const date = dayjs(value as string);
    return date.isValid() ? renderDateValue(date, pattern, timeZone) : undefined;
  }, invalidDisplayValue);
  return (value) => {
    if (value == null) return ok('');
    return render(value).andThen((text) =>
      text === undefined ? err(invalidDisplayValue()) : ok(text)
    );
  };
};

const textFormatter = (multiple: boolean): FieldDisplayValueFormatter =>
  Result.fromThrowable(
    (value: unknown) => (multiple && Array.isArray(value) ? value.join(', ') : (value ?? '')),
    invalidDisplayValue
  );

const selectFormatter = (multiple: boolean): FieldDisplayValueFormatter => {
  const formatOne = Result.fromThrowable((value: unknown) => {
    const text = value == null ? '' : String(value);
    return multiple && text.includes(',') ? `"${text}"` : text;
  }, invalidDisplayValue);
  const formatArray = withMultipleValues(formatOne, true);
  return (value) => (Array.isArray(value) ? formatArray(value) : ok(value ?? ''));
};

const userFormatter = (multiple: boolean): FieldDisplayValueFormatter => {
  const formatOne: FieldDisplayValueFormatter = (value) => {
    if (value == null) return ok('');
    const title = typeof value === 'object' && 'title' in value ? value.title : undefined;
    if (multiple && title) {
      if (typeof title !== 'string') return err(invalidDisplayValue());
      return ok(title.includes(',') ? `"${title}"` : title);
    }
    return ok(title || '');
  };
  // User and link serializers accept arrays even for historically scalar fields.
  return withMultipleValues(formatOne, true);
};

const computedFormatter = (
  cellValueType: string,
  multiple: boolean,
  formatting: NumberFormatting | DateTimeFormatting | undefined
): FieldDisplayValueFormatter => {
  const formatOne =
    cellValueType === 'number'
      ? numberFormatter(
          formatting instanceof NumberFormatting ? formatting : NumberFormatting.default()
        )
      : cellValueType === 'dateTime'
        ? dateFormatter(
            formatting instanceof DateTimeFormatting ? formatting : DateTimeFormatting.default()
          )
        : stringifyValue;
  return withMultipleValues(formatOne, multiple, true);
};

/** Resolve immutable formatting metadata once per field, then reuse the returned formatter. */
export class FieldDisplayValueVisitor extends AbstractFieldVisitor<FieldDisplayValueFormatter> {
  constructor(private readonly multiplicityOverride?: boolean) {
    super();
  }

  visitSingleLineTextField(_field: SingleLineTextField) {
    return ok(textFormatter(this.multiplicityOverride ?? false));
  }

  visitLongTextField(_field: LongTextField) {
    return ok(textFormatter(this.multiplicityOverride ?? false));
  }

  visitNumberField(field: NumberField) {
    return ok(
      withMultipleValues(numberFormatter(field.formatting()), this.multiplicityOverride ?? false)
    );
  }

  visitRatingField(_field: RatingField) {
    return ok(withMultipleValues(stringifyValue, this.multiplicityOverride ?? false));
  }

  visitFormulaField(field: FormulaField): Result<FieldDisplayValueFormatter, DomainError> {
    return field
      .cellValueType()
      .andThen((type) =>
        field
          .isMultipleCellValue()
          .map((multiple) =>
            computedFormatter(
              type.toString(),
              this.multiplicityOverride ?? multiple.toBoolean(),
              field.formatting()
            )
          )
      );
  }

  visitRollupField(field: RollupField): Result<FieldDisplayValueFormatter, DomainError> {
    return field
      .cellValueType()
      .andThen((type) =>
        field
          .isMultipleCellValue()
          .map((multiple) =>
            computedFormatter(
              type.toString(),
              this.multiplicityOverride ?? multiple.toBoolean(),
              field.formatting()
            )
          )
      );
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<FieldDisplayValueFormatter, DomainError> {
    return field
      .cellValueType()
      .andThen((type) =>
        field
          .isMultipleCellValue()
          .map((multiple) =>
            computedFormatter(
              type.toString(),
              this.multiplicityOverride ?? multiple.toBoolean(),
              field.formatting()
            )
          )
      );
  }

  visitSingleSelectField(_field: SingleSelectField) {
    return ok(selectFormatter(this.multiplicityOverride ?? false));
  }

  visitMultipleSelectField(_field: MultipleSelectField) {
    return ok(selectFormatter(this.multiplicityOverride ?? true));
  }

  visitCheckboxField(_field: CheckboxField) {
    const format = Result.fromThrowable((value: unknown) => String(value), invalidDisplayValue);
    return ok(withMultipleValues(format, this.multiplicityOverride ?? false));
  }

  visitAttachmentField(_field: AttachmentField) {
    const format = withMultipleValues(
      Result.fromThrowable((value: unknown) => {
        if (value == null) return '';
        const name = typeof value === 'object' && 'name' in value ? value.name : undefined;
        const token = typeof value === 'object' && 'token' in value ? value.token : undefined;
        return `${name} (${token})`;
      }, invalidDisplayValue),
      true,
      true,
      ','
    );
    return ok<FieldDisplayValueFormatter, DomainError>((value) => (value ? format(value) : ok('')));
  }

  visitDateField(field: DateField) {
    return ok(
      withMultipleValues(dateFormatter(field.formatting()), this.multiplicityOverride ?? false)
    );
  }

  visitCreatedTimeField(field: CreatedTimeField) {
    return ok(
      withMultipleValues(
        dateFormatter(field.formatting()),
        this.multiplicityOverride ?? false,
        true
      )
    );
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField) {
    return ok(
      withMultipleValues(
        dateFormatter(field.formatting()),
        this.multiplicityOverride ?? false,
        true
      )
    );
  }

  visitUserField(field: UserField) {
    return ok(userFormatter(this.multiplicityOverride ?? field.multiplicity().toBoolean()));
  }

  visitCreatedByField(_field: CreatedByField) {
    return ok(userFormatter(this.multiplicityOverride ?? false));
  }

  visitLastModifiedByField(_field: LastModifiedByField) {
    return ok(userFormatter(this.multiplicityOverride ?? false));
  }

  visitAutoNumberField(_field: AutoNumberField) {
    return ok(withMultipleValues(stringifyValue, this.multiplicityOverride ?? false));
  }

  visitButtonField(_field: ButtonField) {
    return ok<FieldDisplayValueFormatter, DomainError>(() => ok(''));
  }

  visitLinkField(_field: LinkField) {
    return ok(
      withMultipleValues(
        (value) =>
          ok(value && typeof value === 'object' && 'title' in value ? value.title || '' : ''),
        true
      )
    );
  }

  override visitLookupField(field: LookupField): Result<FieldDisplayValueFormatter, DomainError> {
    return field
      .isMultipleCellValue()
      .andThen((multiple) =>
        field
          .innerField()
          .andThen((inner) =>
            inner.accept(
              new FieldDisplayValueVisitor(this.multiplicityOverride ?? multiple.toBoolean())
            )
          )
      );
  }

  override visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<FieldDisplayValueFormatter, DomainError> {
    return field
      .isMultipleCellValue()
      .andThen((multiple) =>
        field
          .innerField()
          .andThen((inner) =>
            inner.accept(
              new FieldDisplayValueVisitor(this.multiplicityOverride ?? multiple.toBoolean())
            )
          )
      );
  }
}
