import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import {
  escapeJsonPathRegexLiteral,
  escapeJsonPathStringLiteral,
} from '../../../../../utils/postgres-regex-escape';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleStringCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, _operator);
    // Bind the jsonpath as a parameter; never concatenate the raw value into the
    // SQL string (a single quote would otherwise break out and inject SQL).
    const jsonPath = `$[*] ? (@ == "${escapeJsonPathStringLiteral(String(value))}")`;
    builderClient.whereRaw(`${this.tableColumnRef}::jsonb @\\? ?`, [jsonPath]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const jsonPath = `$[*] ? (@ == "${escapeJsonPathStringLiteral(String(value))}")`;
    builderClient.whereRaw(`NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @\\? ?`, [jsonPath]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, _operator);
    const jsonPath = `$[*] ? (@ like_regex "${escapeJsonPathRegexLiteral(String(value))}" flag "i")`;
    builderClient.whereRaw(`${this.tableColumnRef}::jsonb @\\? ?`, [jsonPath]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, _operator);
    const jsonPath = `$[*] ? (@ like_regex "${escapeJsonPathRegexLiteral(String(value))}" flag "i")`;
    builderClient.whereRaw(`NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @\\? ?`, [jsonPath]);
    return builderClient;
  }
}
