import { DateFormattingPreset, FieldType, TimeFormatting } from '@teable/v2-core';
import { sql, type RawBuilder } from 'kysely';

type DateTimeFormattingLike = {
  date: () => string;
  time: () => string;
  timeZone: () => { toString: () => string };
};

type DateLikeField = {
  type?: () => { equals: (other: unknown) => boolean };
  formatting?: () => DateTimeFormattingLike;
};

const getPostgresDateSortFormatString = (date: string): string => {
  switch (date) {
    case DateFormattingPreset.Y:
      return 'YYYY';
    case DateFormattingPreset.M:
    case DateFormattingPreset.YM:
      return 'YYYY-MM';
    default:
      return 'YYYY-MM-DD';
  }
};

const resolveDateLikeFormatting = (
  field: unknown
): {
  fieldType: { equals: (other: unknown) => boolean };
  formatting: DateTimeFormattingLike;
} | null => {
  const candidate = field as DateLikeField;
  const fieldType = candidate.type?.();
  const formatting = candidate.formatting?.();

  if (!fieldType || !formatting) {
    return null;
  }

  const isDateLike =
    fieldType.equals(FieldType.date()) ||
    fieldType.equals(FieldType.createdTime()) ||
    fieldType.equals(FieldType.lastModifiedTime());

  return isDateLike ? { fieldType, formatting } : null;
};

export const buildDateLikeOrderExpression = (
  field: unknown,
  tableAlias: string,
  column: string
): RawBuilder<unknown> | null => {
  const dateLike = resolveDateLikeFormatting(field);
  if (!dateLike || dateLike.formatting.time() !== TimeFormatting.None) {
    return null;
  }

  const columnRef = sql.ref(`${tableAlias}.${column}`);
  const localizedExpr = sql`timezone(${dateLike.formatting.timeZone().toString()}, ${columnRef})`;

  return sql`to_char(${localizedExpr}, ${getPostgresDateSortFormatString(dateLike.formatting.date())})`;
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
