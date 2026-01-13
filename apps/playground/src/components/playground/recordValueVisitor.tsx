import type { ReactNode } from 'react';
import {
  AbstractFieldVisitor,
  ok,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type DateTimeFormatting,
  type DomainError,
  type Field,
  type FormulaField,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type NumberFormatting,
  type RatingField,
  type Result,
  type RollupField,
  type SelectOption,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
} from '@teable/v2-core';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type FormattedRecordValue = {
  text: string;
  node: ReactNode;
  cellClassName?: string;
};

const emptyRecordValue: FormattedRecordValue = {
  text: '-',
  node: <span className="text-xs text-muted-foreground">-</span>,
  cellClassName: 'text-muted-foreground',
};

const isEmptyRecordValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

export const stringifyRecordValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  try {
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
};

const formatTextCellValue = (text: string, cellClassName = 'truncate'): FormattedRecordValue => {
  if (!text) return emptyRecordValue;
  return {
    text,
    node: text,
    cellClassName,
  };
};

const formatBadgeListValue = (
  labels: string[],
  options?: {
    variant?: 'secondary' | 'outline' | 'default' | 'destructive';
    maxBadges?: number;
    badgeClassName?: string;
  }
): FormattedRecordValue => {
  if (!labels.length) return emptyRecordValue;
  const maxBadges = options?.maxBadges ?? 3;
  const visible = labels.slice(0, maxBadges);
  const remaining = labels.length - visible.length;
  const renderLabels = remaining > 0 ? [...visible, `+${remaining}`] : visible;
  return {
    text: labels.join(', '),
    node: (
      <div className="flex flex-wrap gap-1">
        {renderLabels.map((label) => (
          <Badge
            key={label}
            variant={options?.variant ?? 'secondary'}
            className={cn('min-w-0', options?.badgeClassName)}
          >
            {label}
          </Badge>
        ))}
      </div>
    ),
    cellClassName: 'whitespace-normal',
  };
};

const resolveNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const resolveBooleanValue = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
};

const formatNumberText = (value: number, formatting: NumberFormatting): string => {
  const dto = formatting.toDto();
  const precision = dto.precision ?? 0;

  if (dto.type === 'percent') {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'percent',
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    return formatter.format(value);
  }

  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  if (dto.type === 'currency') {
    const symbol = dto.symbol ?? '$';
    const sign = value < 0 ? '-' : '';
    return `${sign}${symbol}${formatter.format(Math.abs(value))}`;
  }

  return formatter.format(value);
};

const formatDateTimeText = (value: unknown, formatting: DateTimeFormatting): string | null => {
  if (value === undefined || value === null) return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  const dto = formatting.toDto();
  const timeZone = dto.timeZone === 'utc' ? 'UTC' : dto.timeZone;

  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    const year = Number(part('year'));
    const month = Number(part('month'));
    const day = Number(part('day'));
    const hour24 = Number(part('hour'));
    const minute = Number(part('minute'));
    const hour12 = hour24 % 12 || 12;
    const dayPeriod = hour24 >= 12 ? 'PM' : 'AM';

    const pad2 = (val: number) => String(val).padStart(2, '0');
    const tokens: Record<string, string> = {
      YYYY: String(year),
      MM: pad2(month),
      M: String(month),
      DD: pad2(day),
      D: String(day),
      HH: pad2(hour24),
      hh: pad2(hour12),
      mm: pad2(minute),
      A: dayPeriod,
    };

    const formatWithTokens = (pattern: string) =>
      pattern.replace(/YYYY|MM|DD|HH|hh|mm|M|D|A/g, (match) => tokens[match] ?? match);

    const dateText = formatWithTokens(dto.date);
    if (dto.time === 'None') return dateText;
    const timeText = formatWithTokens(dto.time);
    return `${dateText} ${timeText}`.trim();
  } catch {
    return date.toISOString();
  }
};

const formatBooleanValue = (value: unknown): FormattedRecordValue => {
  const bool = resolveBooleanValue(value);
  if (bool !== null) {
    return formatBadgeListValue([bool ? 'Yes' : 'No'], { variant: 'outline' });
  }
  if (Array.isArray(value)) {
    const labels = value
      .map((entry) => resolveBooleanValue(entry))
      .filter((entry): entry is boolean => entry !== null)
      .map((entry) => (entry ? 'Yes' : 'No'));
    return formatBadgeListValue(labels, { variant: 'outline' });
  }
  return formatTextCellValue(stringifyRecordValue(value));
};

type SelectOptionLookup = {
  byId: Map<string, SelectOption>;
  byName: Map<string, SelectOption>;
};

const buildSelectLookup = (options: ReadonlyArray<SelectOption>): SelectOptionLookup => ({
  byId: new Map(options.map((option) => [option.id().toString(), option])),
  byName: new Map(options.map((option) => [option.name().toString(), option])),
});

const resolveSelectLabel = (lookup: SelectOptionLookup, value: unknown): string | null => {
  if (value === undefined || value === null) return null;

  if (typeof value === 'string') {
    return (
      lookup.byId.get(value)?.name().toString() ??
      lookup.byName.get(value)?.name().toString() ??
      value
    );
  }

  if (typeof value === 'object') {
    const candidate = value as { id?: unknown; name?: unknown };
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.id === 'string') {
      return lookup.byId.get(candidate.id)?.name().toString() ?? candidate.id;
    }
  }

  return stringifyRecordValue(value);
};

const resolveUserLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const candidate = value as { title?: unknown; name?: unknown; email?: unknown; id?: unknown };
    if (typeof candidate.title === 'string') return candidate.title;
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.email === 'string') return candidate.email;
    if (typeof candidate.id === 'string') return candidate.id;
  }
  return stringifyRecordValue(value);
};

const resolveAttachmentLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const candidate = value as { name?: unknown; id?: unknown };
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.id === 'string') return candidate.id;
  }
  return stringifyRecordValue(value);
};

const resolveLinkLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const candidate = value as { title?: unknown; name?: unknown; id?: unknown };
    if (typeof candidate.title === 'string') return candidate.title;
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.id === 'string') return candidate.id;
  }
  return stringifyRecordValue(value);
};

const isUserLikeValue = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  ('title' in value || 'name' in value || 'email' in value || 'id' in value);

const buildUserLookupEntries = (values: unknown[]): FormattedRecordValue[] | null => {
  if (!values.some((value) => isUserLikeValue(value))) return null;
  const labels = values
    .map((entry) => resolveUserLabel(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (!labels.length) return null;
  return labels.map((label) => formatBadgeListValue([label], { variant: 'outline' }));
};

type ComputedField = FormulaField | RollupField | ConditionalRollupField;

const formatComputedFieldValue = (field: ComputedField, value: unknown): FormattedRecordValue => {
  const valueTypeResult = field.cellValueType();
  if (valueTypeResult.isOk()) {
    const valueType = valueTypeResult.value.toString();
    const formatting = field.formatting();

    if (valueType === 'number') {
      const number = resolveNumberValue(value);
      if (number === null) return formatTextCellValue(stringifyRecordValue(value));
      if (formatting) {
        const dto = formatting.toDto();
        if ('precision' in dto) {
          return formatTextCellValue(
            formatNumberText(number, formatting as NumberFormatting),
            'text-right tabular-nums whitespace-nowrap'
          );
        }
      }
      return formatTextCellValue(number.toString(), 'text-right tabular-nums whitespace-nowrap');
    }

    if (valueType === 'dateTime' && formatting) {
      const dto = formatting.toDto();
      if ('date' in dto) {
        const formatted = formatDateTimeText(value, formatting as DateTimeFormatting);
        if (formatted) return formatTextCellValue(formatted, 'font-mono text-xs whitespace-nowrap');
      }
    }

    if (valueType === 'boolean') {
      return formatBooleanValue(value);
    }
  }

  return formatTextCellValue(stringifyRecordValue(value));
};

const formatLookupEntryList = (entries: FormattedRecordValue[]): FormattedRecordValue => {
  if (!entries.length) return emptyRecordValue;
  return {
    text: '',
    node: (
      <div className="flex flex-wrap gap-1 max-w-full min-w-0 [data-slot=badge]:max-w-full [data-slot=badge]:whitespace-normal [data-slot=badge]:break-words [data-slot=badge]:shrink [data-slot=badge]:min-w-0">
        {entries.map((entry) => (
          <span
            key={`${entry.text}-${entry.cellClassName ?? ''}`}
            className={cn('max-w-full min-w-0', entry.cellClassName)}
          >
            {entry.node}
          </span>
        ))}
      </div>
    ),
    cellClassName: 'whitespace-normal',
  };
};

class RecordValueVisitor extends AbstractFieldVisitor<FormattedRecordValue> {
  constructor(private readonly value: unknown) {
    super();
  }

  visitSingleLineTextField(field: SingleLineTextField) {
    const text = stringifyRecordValue(this.value);
    const showAs = field.showAs()?.type();
    if (!text) return ok(emptyRecordValue);

    if (showAs === 'url') {
      const href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      return ok({
        text,
        node: (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
            {text}
          </a>
        ),
        cellClassName: 'truncate',
      });
    }

    if (showAs === 'email') {
      return ok({
        text,
        node: (
          <a href={`mailto:${text}`} className="text-primary underline">
            {text}
          </a>
        ),
        cellClassName: 'truncate',
      });
    }

    if (showAs === 'phone') {
      return ok({
        text,
        node: (
          <a href={`tel:${text}`} className="text-primary underline">
            {text}
          </a>
        ),
        cellClassName: 'truncate',
      });
    }

    return ok(formatTextCellValue(text));
  }

  visitLongTextField(_field: LongTextField) {
    const text = stringifyRecordValue(this.value);
    return ok(formatTextCellValue(text));
  }

  visitNumberField(field: NumberField) {
    const number = resolveNumberValue(this.value);
    if (number === null) return ok(formatTextCellValue(stringifyRecordValue(this.value)));
    return ok(
      formatTextCellValue(
        formatNumberText(number, field.formatting()),
        'text-right tabular-nums whitespace-nowrap'
      )
    );
  }

  visitAutoNumberField(_field: AutoNumberField) {
    const number = resolveNumberValue(this.value);
    if (number === null) return ok(formatTextCellValue(stringifyRecordValue(this.value)));
    return ok(formatTextCellValue(number.toString(), 'text-right tabular-nums whitespace-nowrap'));
  }

  visitRatingField(field: RatingField) {
    const rating = resolveNumberValue(this.value);
    if (rating === null) return ok(formatTextCellValue(stringifyRecordValue(this.value)));
    const max = field.ratingMax().toNumber();
    return ok(
      formatTextCellValue(`${rating} / ${max}`, 'text-right tabular-nums whitespace-nowrap')
    );
  }

  visitCheckboxField(_field: CheckboxField) {
    return ok(formatBooleanValue(this.value));
  }

  visitDateField(field: DateField) {
    const formatted = formatDateTimeText(this.value, field.formatting());
    return ok(
      formatted
        ? formatTextCellValue(formatted, 'font-mono text-xs whitespace-nowrap')
        : emptyRecordValue
    );
  }

  visitCreatedTimeField(field: CreatedTimeField) {
    const formatted = formatDateTimeText(this.value, field.formatting());
    return ok(
      formatted
        ? formatTextCellValue(formatted, 'font-mono text-xs whitespace-nowrap')
        : emptyRecordValue
    );
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField) {
    const formatted = formatDateTimeText(this.value, field.formatting());
    return ok(
      formatted
        ? formatTextCellValue(formatted, 'font-mono text-xs whitespace-nowrap')
        : emptyRecordValue
    );
  }

  visitSingleSelectField(field: SingleSelectField) {
    const lookup = buildSelectLookup(field.selectOptions());
    const label = resolveSelectLabel(lookup, this.value);
    return ok(label ? formatBadgeListValue([label], { variant: 'secondary' }) : emptyRecordValue);
  }

  visitMultipleSelectField(field: MultipleSelectField) {
    const lookup = buildSelectLookup(field.selectOptions());
    const values = Array.isArray(this.value) ? this.value : [this.value];
    const labels = values
      .map((entry) => resolveSelectLabel(lookup, entry))
      .filter((entry): entry is string => Boolean(entry));
    return ok(formatBadgeListValue(labels, { variant: 'secondary' }));
  }

  visitUserField(field: UserField) {
    const values = field.multiplicity().toBoolean()
      ? Array.isArray(this.value)
        ? this.value
        : [this.value]
      : Array.isArray(this.value)
        ? this.value.slice(0, 1)
        : [this.value];
    const labels = values
      .map((entry) => resolveUserLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    return ok(formatBadgeListValue(labels, { variant: 'outline' }));
  }

  visitCreatedByField(_field: CreatedByField) {
    const values = Array.isArray(this.value) ? this.value : [this.value];
    const labels = values
      .map((entry) => resolveUserLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    return ok(formatBadgeListValue(labels, { variant: 'outline' }));
  }

  visitLastModifiedByField(_field: LastModifiedByField) {
    const values = Array.isArray(this.value) ? this.value : [this.value];
    const labels = values
      .map((entry) => resolveUserLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    return ok(formatBadgeListValue(labels, { variant: 'outline' }));
  }

  visitAttachmentField(_field: AttachmentField) {
    const attachments = Array.isArray(this.value) ? this.value : [this.value];
    const labels = attachments
      .map((entry) => resolveAttachmentLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (!labels.length) return ok(emptyRecordValue);
    if (labels.length === 1) return ok(formatBadgeListValue([labels[0]], { variant: 'outline' }));
    return ok({
      text: labels.join(', '),
      node: <Badge variant="outline">{`${labels.length} files`}</Badge>,
      cellClassName: 'whitespace-nowrap',
    });
  }

  visitButtonField(field: ButtonField) {
    const label = field.label().toString();
    const count =
      typeof this.value === 'object' && this.value !== null && 'count' in this.value
        ? Number((this.value as { count?: unknown }).count)
        : resolveNumberValue(this.value);
    const text =
      typeof count === 'number' && Number.isFinite(count) ? `${label} (${count})` : label;
    return ok({
      text,
      node: <Badge variant="outline">{text}</Badge>,
      cellClassName: 'whitespace-nowrap',
    });
  }

  visitLinkField(field: LinkField) {
    const values = field.isMultipleValue()
      ? Array.isArray(this.value)
        ? this.value
        : [this.value]
      : Array.isArray(this.value)
        ? this.value.slice(0, 1)
        : [this.value];
    const labels = values
      .map((entry) => resolveLinkLabel(entry))
      .filter((entry): entry is string => Boolean(entry));
    return ok(
      formatBadgeListValue(labels, {
        variant: 'outline',
        badgeClassName: 'max-w-[140px] min-w-0 w-auto justify-start text-left truncate',
      })
    );
  }

  visitLookupField(field: LookupField): Result<FormattedRecordValue, DomainError> {
    const values = Array.isArray(this.value) ? this.value : [this.value];
    const innerFieldResult = field.innerField();
    if (innerFieldResult.isErr()) {
      const userEntries = buildUserLookupEntries(values);
      if (userEntries) {
        return ok(formatLookupEntryList(userEntries));
      }
      const labels = values
        .map((entry) => stringifyRecordValue(entry))
        .filter((entry): entry is string => Boolean(entry));
      return ok(formatBadgeListValue(labels, { variant: 'secondary' }));
    }

    const innerField = innerFieldResult.value;
    const entries = values.reduce<FormattedRecordValue[]>((acc, entry) => {
      if (isEmptyRecordValue(entry)) return acc;
      const formattedResult = innerField.accept(new RecordValueVisitor(entry));
      acc.push(
        formattedResult.isErr()
          ? formatTextCellValue(stringifyRecordValue(entry))
          : formattedResult.value
      );
      return acc;
    }, []);
    return ok(formatLookupEntryList(entries));
  }

  visitFormulaField(field: FormulaField) {
    return ok(formatComputedFieldValue(field, this.value));
  }

  visitRollupField(field: RollupField) {
    return ok(formatComputedFieldValue(field, this.value));
  }

  visitConditionalRollupField(field: ConditionalRollupField) {
    return ok(formatComputedFieldValue(field, this.value));
  }

  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<FormattedRecordValue, DomainError> {
    const values = Array.isArray(this.value) ? this.value : [this.value];
    const innerFieldResult = field.innerField();
    if (innerFieldResult.isErr()) {
      const userEntries = buildUserLookupEntries(values);
      if (userEntries) {
        return ok(formatLookupEntryList(userEntries));
      }
      const labels = values
        .map((entry) => stringifyRecordValue(entry))
        .filter((entry): entry is string => Boolean(entry));
      return ok(formatBadgeListValue(labels, { variant: 'secondary' }));
    }

    const innerField = innerFieldResult.value;
    const entries = values.reduce<FormattedRecordValue[]>((acc, entry) => {
      if (isEmptyRecordValue(entry)) return acc;
      const formattedResult = innerField.accept(new RecordValueVisitor(entry));
      acc.push(
        formattedResult.isErr()
          ? formatTextCellValue(stringifyRecordValue(entry))
          : formattedResult.value
      );
      return acc;
    }, []);
    return ok(formatLookupEntryList(entries));
  }
}

export const formatRecordValue = (field: Field, value: unknown): FormattedRecordValue => {
  if (isEmptyRecordValue(value)) return emptyRecordValue;

  const result = field.accept(new RecordValueVisitor(value));
  if (result.isOk()) return result.value;

  return formatTextCellValue(stringifyRecordValue(value));
};
