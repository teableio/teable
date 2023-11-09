import type {
  IFilterOperator,
  IFilterValue,
  ILiteralValue,
  ILiteralValueList,
} from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../../features/field/model/factory';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class JsonCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const sql = `${jsonColumn} = ?`;
    queryBuilder.whereRaw(sql, [value]);
    return queryBuilder;
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValue }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const sql = `ifnull(${jsonColumn}, '') != ?`;
    queryBuilder.whereRaw(sql, [value]);
    return queryBuilder;
  }

  isAnyOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const sql = `${jsonColumn} in (${this.createSqlPlaceholders(value)})`;
    queryBuilder.whereRaw(sql, [...value]);
    return queryBuilder;
  }

  isNoneOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: ILiteralValueList }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const jsonColumn = this.getJsonQueryColumn(field, operator);
    const sql = `ifnull(${jsonColumn}, '') not in (${this.createSqlPlaceholders(value)})`;
    queryBuilder.whereRaw(sql, [...value]);
    return queryBuilder;
  }

  containsOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const sql = `${this.getJsonQueryColumn(field, operator)} like ?`;
    queryBuilder.whereRaw(sql, [`%${value}%`]);
    return queryBuilder;
  }

  doesNotContainOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, operator, value } = params;

    const sql = `ifnull(${this.getJsonQueryColumn(field, operator)}, '') not like ?`;
    queryBuilder.whereRaw(sql, [`%${value}%`]);
    return queryBuilder;
  }
}
