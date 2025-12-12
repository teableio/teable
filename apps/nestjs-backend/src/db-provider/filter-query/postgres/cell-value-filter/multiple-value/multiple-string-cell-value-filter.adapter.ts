import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import { escapeJsonbRegex } from '../../../../../utils/postgres-regex-escape';
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
    const jsonPath = '$[*] ? (@ == $value)';
    builderClient.whereRaw(
      `jsonb_path_exists(${this.tableColumnRef}::jsonb, '${jsonPath}'::jsonpath, jsonb_build_object('value', to_jsonb(?::text)))`,
      [String(value)]
    );
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const jsonPath = '$[*] ? (@ == $value)';
    builderClient.whereRaw(
      `NOT jsonb_path_exists(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '${jsonPath}'::jsonpath, jsonb_build_object('value', to_jsonb(?::text)))`,
      [String(value)]
    );
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const escapedValue = escapeJsonbRegex(String(value));
    this.ensureLiteralValue(value, _operator);
    const jsonPath = '$[*] ? (@ like_regex $value flag "i")';
    builderClient.whereRaw(
      `jsonb_path_exists(${this.tableColumnRef}::jsonb, '${jsonPath}'::jsonpath, jsonb_build_object('value', to_jsonb(?::text)))`,
      [escapedValue]
    );
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const escapedValue = escapeJsonbRegex(String(value));
    this.ensureLiteralValue(value, _operator);
    const jsonPath = '$[*] ? (@ like_regex $value flag "i")';
    builderClient.whereRaw(
      `NOT jsonb_path_exists(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '${jsonPath}'::jsonpath, jsonb_build_object('value', to_jsonb(?::text)))`,
      [escapedValue]
    );
    return builderClient;
  }
}
