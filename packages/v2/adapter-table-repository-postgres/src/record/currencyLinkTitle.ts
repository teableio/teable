import { type Field, NumberField, NumberFormattingType } from '@teable/v2-core';
import { sqlStringLiteral } from '@teable/v2-formula-sql-pg';
import { sql, type RawBuilder } from 'kysely';

export const currencyLinkTitle = (field: Field, column: RawBuilder<unknown>) => {
  if (!(field instanceof NumberField)) return undefined;
  const format = field.formatting();
  if (format.type() !== NumberFormattingType.Currency) return undefined;

  // Rounding numeric retains the requested scale without limiting the integer width.
  const symbol = sql.raw(sqlStringLiteral(format.symbol() ?? ''));
  return sql<string>`${symbol} || round(${column}::numeric, ${sql.lit(format.precision().toNumber())})::text`;
};
