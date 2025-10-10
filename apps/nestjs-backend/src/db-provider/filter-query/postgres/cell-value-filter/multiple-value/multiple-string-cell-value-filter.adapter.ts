import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import { escapeJsonbRegex } from '../../../../../utils/postgres-regex-escape';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleStringCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ == "${value}")'`, [this.tableColumnRef]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@ == "${value}")'`, [
      this.tableColumnRef,
    ]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const escapedValue = escapeJsonbRegex(String(value));
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ like_regex "${escapedValue}" flag "i")'`, [
      this.tableColumnRef,
    ]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const escapedValue = escapeJsonbRegex(String(value));
    builderClient.whereRaw(
      `NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@ like_regex "${escapedValue}" flag "i")'`,
      [this.tableColumnRef]
    );
    return builderClient;
  }
}
