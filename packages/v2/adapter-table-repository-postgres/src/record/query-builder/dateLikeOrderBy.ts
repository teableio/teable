import { CellValueType, DateFormattingPreset, FieldType, TimeFormatting } from '@teable/v2-core';
import { sql, type RawBuilder } from 'kysely';

type DateTimeFormattingLike = {
  date: () => string;
  time: () => string;
  timeZone: () => { toString: () => string };
};

type DateLikeField = {
  type?: () => { equals: (other: unknown) => boolean };
  formatting?: () => DateTimeFormattingLike | undefined;
  cellValueType?: () => {
    isOk: () => boolean;
    value: { equals: (other: unknown) => boolean };
  };
  isMultipleCellValue?: () => {
    isOk: () => boolean;
    value: { isMultiple: () => boolean };
  };
};

const hasDateTimeFormatting = (
  formatting: DateTimeFormattingLike | undefined
): formatting is DateTimeFormattingLike =>
  Boolean(
    formatting && typeof formatting.date === 'function' && typeof formatting.time === 'function'
  );

const resolveDateLikeFormatting = (
  field: unknown
): {
  fieldType: { equals: (other: unknown) => boolean };
  formatting: DateTimeFormattingLike;
} | null => {
  const candidate = field as DateLikeField;
  const fieldType = candidate.type?.();
  const formatting = candidate.formatting?.();

  if (!fieldType || !hasDateTimeFormatting(formatting)) {
    return null;
  }

  const isStoredDate =
    fieldType.equals(FieldType.date()) ||
    fieldType.equals(FieldType.createdTime()) ||
    fieldType.equals(FieldType.lastModifiedTime());
  if (isStoredDate) {
    return { fieldType, formatting };
  }

  // Formula date results keep a raw timestamptz. v1 aggregation already buckets
  // them by cell value type, so v2 list headers must use the same display unit
  // or non-bucket-start nested groups never receive statistics. Rollup and
  // conditional rollup stay raw: collapsed-group exclusion only expands
  // exactFormatDate for formula dateTime, and a display bucket there would
  // hide a single day instead of the month or year.
  if (!fieldType.equals(FieldType.formula())) {
    return null;
  }
  const cellValueType = candidate.cellValueType?.();
  if (!cellValueType?.isOk() || !cellValueType.value.equals(CellValueType.dateTime())) {
    return null;
  }
  const multiplicity = candidate.isMultipleCellValue?.();
  if (multiplicity?.isOk() && multiplicity.value.isMultiple()) {
    return null;
  }
  return { fieldType, formatting };
};

const resolveDateTruncUnit = (date: string, time: string): 'year' | 'month' | 'day' | 'minute' => {
  switch (date) {
    case DateFormattingPreset.Y:
      return 'year';
    case DateFormattingPreset.M:
    case DateFormattingPreset.YM:
      return 'month';
    default:
      return time !== TimeFormatting.None ? 'minute' : 'day';
  }
};

const IANA_TIME_ZONE_PATTERN = /^[\w+\-/]+$/;

/**
 * V1 parity group key for date-like fields: truncate in the field's local time
 * at the formatting granularity and key the group as timestamptz, matching
 * `TIMEZONE(tz, DATE_TRUNC(unit, TIMEZONE(tz, col)))` in the legacy group query.
 *
 * timeZone/unit are inlined as literals (not bound parameters) so the SELECT,
 * GROUP BY and ORDER BY renderings stay byte-identical — with parameters the
 * numbering differs per position and PostgreSQL rejects the grouped query.
 */
export const buildDateLikeGroupExpression = (
  field: unknown,
  tableAlias: string,
  column: string
): RawBuilder<unknown> | null => {
  const dateLike = resolveDateLikeFormatting(field);
  if (!dateLike) {
    return null;
  }

  const timeZone = dateLike.formatting.timeZone().toString();
  if (!IANA_TIME_ZONE_PATTERN.test(timeZone)) {
    return null;
  }
  const unit = resolveDateTruncUnit(dateLike.formatting.date(), dateLike.formatting.time());
  const columnRef = sql.ref(`${tableAlias}.${column}`);

  return sql`timezone(${sql.lit(timeZone)}, date_trunc(${sql.lit(
    unit
  )}, timezone(${sql.lit(timeZone)}, ${columnRef})))`;
};
