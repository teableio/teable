import { FormulaSqlPgExpressionBuilder } from './FormulaSqlPgExpressionBuilder';
import { buildErrorLiteral } from './PgSqlHelpers';
import {
  buildErrorMessageSql,
  combineErrorConditions,
  guardValueSql,
  makeExpr,
  type SqlExpr,
} from './SqlExpression';

/** A narrow physical lowering: retain all ordinary function coercion/error semantics. */
export class FormulaSqlPgArrayFusion extends FormulaSqlPgExpressionBuilder {
  sumCompactTextSplit(textExpr: SqlExpr, delimiterExpr: SqlExpr): SqlExpr {
    const text = this.coerceToString(textExpr, false);
    const delimiter = this.coerceToString(delimiterExpr);
    const splitError = combineErrorConditions([text, delimiter]);
    const split = makeExpr(
      'NULL',
      'string',
      true,
      splitError,
      buildErrorMessageSql([text, delimiter], buildErrorLiteral('TYPE', 'cannot_cast_to_text'))
    );
    const compactError = combineErrorConditions([split]);
    const compact = makeExpr(
      'NULL',
      'string',
      true,
      compactError,
      buildErrorMessageSql([split], buildErrorLiteral('TYPE', 'array_compact_invalid'))
    );
    const errorCondition = combineErrorConditions([compact]);
    const errorMessage = buildErrorMessageSql(
      [compact],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    // TEXTSPLIT produces text elements, so JSON string extraction is the identity.
    // SUM's existing array semantics ignore invalid element casts and return NULL
    // for an empty/all-invalid input. Reuse its loose numeric cast unchanged.
    const number = this.coerceToNumber(
      makeExpr('token', 'unknown', false, compactError, compact.errorMessageSql),
      'sum'
    );
    const valueSql = `(SELECT SUM(${number.valueSql})
      FROM unnest(string_to_array(${text.valueSql}, ${delimiter.valueSql})) AS tokens(token)
      WHERE token IS NOT NULL AND token <> '')`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }
}
