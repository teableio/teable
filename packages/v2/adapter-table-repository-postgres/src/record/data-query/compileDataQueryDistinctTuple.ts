import type { BoundDataQueryFormulaExpression } from '@teable/v2-data-query';
import { sql, type RawBuilder } from 'kysely';
import { ok, safeTry } from 'neverthrow';

import {
  compileDataQueryFormulaExpression,
  type DataQueryExpressionSqlContext,
} from './compileDataQueryExpression';

/** A tuple counts public values, including NULL components, without string concatenation. */
export const compileDataQueryDistinctTuple = (
  expressions: readonly BoundDataQueryFormulaExpression[],
  context: DataQueryExpressionSqlContext
) =>
  safeTry(function* () {
    const inputs: RawBuilder<unknown>[] = [];
    const keys: RawBuilder<unknown>[] = [];
    for (const [index, expression] of expressions.entries()) {
      const alias = `key_${index}`;
      inputs.push(
        sql`${yield* compileDataQueryFormulaExpression(expression, context)} as ${sql.id(alias)}`
      );
      const value = sql.id('tuple_inputs', alias);
      // Formula binding admits only scalar outputs. Its finalizer already lowers
      // user/link objects to display text and numbers to float8, so recursive
      // JSON normalization would add a costly, unreachable composite branch.
      switch (expression.valueType.toString()) {
        case 'dateTime':
          // Native epoch milliseconds preserve AD/BC and floor negative
          // submillisecond instants like the PostgreSQL driver's Date parser.
          keys.push(
            sql`case when isfinite(${value}::timestamptz) then to_jsonb(floor(extract(epoch from ${value}::timestamptz) * 1000)) else null::jsonb end`
          );
          break;
        case 'number':
          keys.push(
            sql`case when ${value}::text in ('NaN', 'Infinity', '-Infinity') then null::jsonb else to_jsonb(${value}) end`
          );
          break;
        default:
          keys.push(sql`to_jsonb(${value})`);
      }
    }
    // Keep finalization above a completed projection so each formula is evaluated
    // once, including when scalar normalization references its value repeatedly.
    return ok(sql`(select jsonb_build_array(${sql.join(keys)}) from (
      select ${sql.join(inputs)} offset 0
    ) as ${sql.id('tuple_inputs')} offset 0)`);
  });
