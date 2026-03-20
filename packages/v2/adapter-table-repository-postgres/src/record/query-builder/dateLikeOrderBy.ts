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

export const buildDateLikeOrderExpression = (
  field: unknown,
  tableAlias: string,
  column: string
): RawBuilder<unknown> | null => {
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

  if (!isDateLike || formatting.time() !== TimeFormatting.None) {
    return null;
  }

  const columnRef = sql.ref(`${tableAlias}.${column}`);
  const localizedExpr = sql`timezone(${formatting.timeZone().toString()}, ${columnRef})`;

  return sql`to_char(${localizedExpr}, ${getPostgresDateSortFormatString(formatting.date())})`;
};
