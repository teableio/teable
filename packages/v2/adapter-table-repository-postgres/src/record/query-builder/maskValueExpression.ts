import { sql, type Expression, type RawBuilder, type SqlBool } from 'kysely';

/** Masked field value: restricted cells are SQL NULL. */
export const maskValueExpression = (
  maskSql: Expression<SqlBool>,
  valueExpression: RawBuilder<unknown>
): RawBuilder<unknown> => sql`CASE WHEN ${maskSql} THEN ${valueExpression} ELSE NULL END`;
