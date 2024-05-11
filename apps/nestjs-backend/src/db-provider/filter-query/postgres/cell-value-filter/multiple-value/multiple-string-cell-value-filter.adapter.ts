import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
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
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ like_regex "${value}" flag "i")'`, [
      this.tableColumnRef,
    ]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(
      `NOT COALESCE(??, '[]')::jsonb @\\? '$[*] \\? (@ like_regex "${value}" flag "i")'`,
      [this.tableColumnRef]
    );
    return builderClient;
  }
}
