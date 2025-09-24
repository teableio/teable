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
    builderClient.whereRaw(`${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ == "${value}")'`);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    builderClient.whereRaw(
      `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @\\? '$[*] \\? (@ == "${value}")'`
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
    builderClient.whereRaw(
      `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ like_regex "${escapedValue}" flag "i")'`
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
    builderClient.whereRaw(
      `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @\\? '$[*] \\? (@ like_regex "${escapedValue}" flag "i")'`
    );
    return builderClient;
  }
}
