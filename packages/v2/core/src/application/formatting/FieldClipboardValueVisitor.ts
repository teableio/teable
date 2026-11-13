import dayjs from 'dayjs';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
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

import { dateDisplayPattern, renderDateValue, renderNumberValue } from './cellValueFormatting';

const asArray = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : [value];

const formatGeneric = (value: unknown, multiple: boolean): string => {
  if (value == null) return '';
  if (multiple || Array.isArray(value)) {
    return asArray(value)
      .map((item) => (item == null ? '' : String(item)))
      .join(', ');
  }
  return String(value);
};

const formatNumber = (value: unknown, formatting: NumberFormatting): string => {
  if (value == null) return '';
  return renderNumberValue(Number(value), formatting);
};

const formatDate = (value: unknown, formatting: DateTimeFormatting): string => {
  if (value == null) return '';
  const text = String(value);
  const date = dayjs(text);
  if (!date.isValid()) return text;

  return renderDateValue(date, dateDisplayPattern(formatting), formatting.timeZone().toString());
};

const formatWithMultiplicity = (
  value: unknown,
  multiple: boolean,
  formatOne: (item: unknown) => string,
  separator = ', '
): string => {
  if (value == null) return '';
  if (!multiple && !Array.isArray(value)) return formatOne(value);
  return asArray(value).map(formatOne).join(separator);
};

const formatStructuredTitle = (value: unknown, quoteComma: boolean): string => {
  if (value == null || typeof value !== 'object') return '';
  const title = (value as { title?: unknown }).title;
  const text = title == null ? '' : String(title);
  return quoteComma && text.includes(',') ? `"${text}"` : text;
};

const formatComputed = (
  value: unknown,
  cellValueType: string,
  multiple: boolean,
  formatting: NumberFormatting | DateTimeFormatting | undefined
): string =>
  formatWithMultiplicity(value, multiple, (item) => {
    if (cellValueType === 'number') {
      return formatNumber(
        item,
        formatting instanceof NumberFormatting ? formatting : NumberFormatting.default()
      );
    }
    if (cellValueType === 'dateTime') {
      return formatDate(
        item,
        formatting instanceof DateTimeFormatting ? formatting : DateTimeFormatting.default()
      );
    }
    return item == null ? '' : String(item);
  });

/**
 * Convert a v2 Field cell value to the clipboard text owned by that Field definition.
 */
export class FieldClipboardValueVisitor extends AbstractFieldVisitor<string> {
  constructor(
    private readonly value: unknown,
    private readonly multiplicityOverride?: boolean
  ) {
    super();
  }

  visitSingleLineTextField(_field: SingleLineTextField): Result<string, DomainError> {
    return ok(formatGeneric(this.value, this.multiplicityOverride ?? false));
  }

  visitLongTextField(_field: LongTextField): Result<string, DomainError> {
    return ok(formatGeneric(this.value, this.multiplicityOverride ?? false));
  }

  visitNumberField(field: NumberField): Result<string, DomainError> {
    return ok(
      formatWithMultiplicity(this.value, this.multiplicityOverride ?? false, (item) =>
        formatNumber(item, field.formatting())
      )
    );
  }

  visitRatingField(_field: RatingField): Result<string, DomainError> {
    return ok(formatGeneric(this.value, this.multiplicityOverride ?? false));
  }

  visitFormulaField(field: FormulaField): Result<string, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((multiple) =>
            formatComputed(
              this.value,
              cellValueType.toString(),
              this.multiplicityOverride ?? multiple.isMultiple(),
              field.formatting()
            )
          )
      );
  }

  visitRollupField(field: RollupField): Result<string, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((multiple) =>
            formatComputed(
              this.value,
              cellValueType.toString(),
              this.multiplicityOverride ?? multiple.isMultiple(),
              field.formatting()
            )
          )
      );
  }

  visitSingleSelectField(_field: SingleSelectField): Result<string, DomainError> {
    const multiple = this.multiplicityOverride ?? false;
    return ok(
      formatWithMultiplicity(this.value, multiple, (item) => {
        const text = item == null ? '' : String(item);
        return multiple && text.includes(',') ? `"${text}"` : text;
      })
    );
  }

  visitMultipleSelectField(_field: MultipleSelectField): Result<string, DomainError> {
    return ok(
      formatWithMultiplicity(this.value, true, (item) => {
        const text = item == null ? '' : String(item);
        return text.includes(',') ? `"${text}"` : text;
      })
    );
  }

  visitCheckboxField(_field: CheckboxField): Result<string, DomainError> {
    return ok(formatGeneric(this.value, this.multiplicityOverride ?? false));
  }

  visitAttachmentField(_field: AttachmentField): Result<string, DomainError> {
    return ok(
      formatWithMultiplicity(
        this.value,
        true,
        (item) => {
          if (item == null || typeof item !== 'object') return '';
          const attachment = item as { name?: unknown; token?: unknown };
          return `${String(attachment.name ?? '')} (${String(attachment.token ?? '')})`;
        },
        ','
      )
    );
  }

  visitDateField(field: DateField): Result<string, DomainError> {
    return ok(
      formatWithMultiplicity(this.value, this.multiplicityOverride ?? false, (item) =>
        formatDate(item, field.formatting())
      )
    );
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<string, DomainError> {
    return ok(
      formatWithMultiplicity(this.value, this.multiplicityOverride ?? false, (item) =>
        formatDate(item, field.formatting())
      )
    );
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<string, DomainError> {
    return ok(
      formatWithMultiplicity(this.value, this.multiplicityOverride ?? false, (item) =>
        formatDate(item, field.formatting())
      )
    );
  }

  visitUserField(field: UserField): Result<string, DomainError> {
    const multiple = this.multiplicityOverride ?? field.multiplicity().toBoolean();
    return ok(
      formatWithMultiplicity(this.value, multiple, (item) => formatStructuredTitle(item, multiple))
    );
  }

  visitCreatedByField(_field: CreatedByField): Result<string, DomainError> {
    const multiple = this.multiplicityOverride ?? false;
    return ok(
      formatWithMultiplicity(this.value, multiple, (item) => formatStructuredTitle(item, multiple))
    );
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<string, DomainError> {
    const multiple = this.multiplicityOverride ?? false;
    return ok(
      formatWithMultiplicity(this.value, multiple, (item) => formatStructuredTitle(item, multiple))
    );
  }

  visitAutoNumberField(_field: AutoNumberField): Result<string, DomainError> {
    return ok(formatGeneric(this.value, this.multiplicityOverride ?? false));
  }

  visitButtonField(_field: ButtonField): Result<string, DomainError> {
    return ok('');
  }

  visitLinkField(_field: LinkField): Result<string, DomainError> {
    return ok(
      formatWithMultiplicity(
        this.value,
        this.multiplicityOverride ?? Array.isArray(this.value),
        (item) => formatStructuredTitle(item, false)
      )
    );
  }

  override visitLookupField(field: LookupField): Result<string, DomainError> {
    return field
      .isMultipleCellValue()
      .andThen((multiple) =>
        field
          .innerField()
          .andThen((inner) =>
            inner.accept(new FieldClipboardValueVisitor(this.value, multiple.isMultiple()))
          )
      );
  }

  visitConditionalRollupField(field: ConditionalRollupField): Result<string, DomainError> {
    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field
          .isMultipleCellValue()
          .map((multiple) =>
            formatComputed(
              this.value,
              cellValueType.toString(),
              this.multiplicityOverride ?? multiple.isMultiple(),
              field.formatting()
            )
          )
      );
  }

  override visitConditionalLookupField(field: ConditionalLookupField): Result<string, DomainError> {
    return field
      .isMultipleCellValue()
      .andThen((multiple) =>
        field
          .innerField()
          .andThen((inner) =>
            inner.accept(new FieldClipboardValueVisitor(this.value, multiple.isMultiple()))
          )
      );
  }
}

export const stringifyClipboardRows = (rows: ReadonlyArray<ReadonlyArray<string>>): string =>
  rows
    .map((row) =>
      row
        .map((cell) =>
          cell.includes('\t') || cell.includes('\n') ? `"${cell.replaceAll('"', '""')}"` : cell
        )
        .join('\t')
    )
    .join('\n');
