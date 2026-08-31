import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import { DateTimeFormatting } from '../types/DateTimeFormatting';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { LookupField } from '../types/LookupField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import { NumberFormatting, NumberFormattingType } from '../types/NumberFormatting';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import { AbstractFieldVisitor } from './AbstractFieldVisitor';

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
  const number = Number(value);
  const precision = formatting.precision().toNumber();
  if (formatting.type() === NumberFormattingType.Currency) {
    const sign = number < 0 ? '-' : '';
    const formatted = Math.abs(number).toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    return `${sign}${formatting.symbol() ?? '$'}${formatted}`;
  }
  if (formatting.type() === NumberFormattingType.Percent) {
    return `${(number * 100).toFixed(precision)}%`;
  }
  return number.toFixed(precision);
};

const formatDate = (value: unknown, formatting: DateTimeFormatting): string => {
  if (value == null) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: formatting.timeZone().toString(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  const hour24 = Number(parts.hour ?? '0');
  const replacements: Record<string, string> = {
    YYYY: parts.year ?? '',
    MM: parts.month ?? '',
    M: String(Number(parts.month ?? '0')),
    DD: parts.day ?? '',
    D: String(Number(parts.day ?? '0')),
    HH: String(hour24).padStart(2, '0'),
    hh: String(hour24 % 12 || 12).padStart(2, '0'),
    mm: parts.minute ?? '',
    A: hour24 >= 12 ? 'PM' : 'AM',
  };
  const pattern =
    formatting.time() === 'None' ? formatting.date() : `${formatting.date()} ${formatting.time()}`;
  return pattern.replace(/YYYY|MM|DD|HH|hh|mm|[MDA]/g, (token) => replacements[token] ?? token);
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
    return ok(formatDate(this.value, field.formatting()));
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<string, DomainError> {
    return ok(formatDate(this.value, field.formatting()));
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
          cell.includes('\t') || cell.includes('\n') ? `"${cell.replace(/"/g, '""')}"` : cell
        )
        .join('\t')
    )
    .join('\n');
