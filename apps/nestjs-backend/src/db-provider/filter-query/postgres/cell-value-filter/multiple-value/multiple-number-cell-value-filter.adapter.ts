import type { IFilterOperator, ILiteralValue } from '@teable/core';
import type { Knex } from 'knex';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleNumberCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`??::jsonb @> '[?]'::jsonb`, [this.tableColumnRef, Number(value)]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`NOT COALESCE(??, '[]')::jsonb @> '[?]'::jsonb`, [
      this.tableColumnRef,
      Number(value),
    ]);
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ > ?)'`, [
      this.tableColumnRef,
      Number(value),
    ]);
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ >= ?)'`, [
      this.tableColumnRef,
      Number(value),
    ]);
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ < ?)'`, [
      this.tableColumnRef,
      Number(value),
    ]);
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`??::jsonb @\\? '$[*] \\? (@ <= ?)'`, [
      this.tableColumnRef,
      Number(value),
    ]);
    return builderClient;
  }
}
