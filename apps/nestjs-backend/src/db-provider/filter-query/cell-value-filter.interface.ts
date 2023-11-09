import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';

export type ICellValueFilterHandler = (
  queryBuilder: Knex.QueryBuilder,
  params: {
    field: IFieldInstance;
    operator: IFilterOperator;
    value: IFilterValue;
  }
) => Knex.QueryBuilder;

export interface ICellValueFilterInterface {
  isOperatorHandler: ICellValueFilterHandler;
  isExactlyOperatorHandler: ICellValueFilterHandler;
  isNotOperatorHandler: ICellValueFilterHandler;
  containsOperatorHandler: ICellValueFilterHandler;
  doesNotContainOperatorHandler: ICellValueFilterHandler;
  isGreaterOperatorHandler: ICellValueFilterHandler;
  isGreaterEqualOperatorHandler: ICellValueFilterHandler;
  isLessOperatorHandler: ICellValueFilterHandler;
  isLessEqualOperatorHandler: ICellValueFilterHandler;
  isAnyOfOperatorHandler: ICellValueFilterHandler;
  isNoneOfOperatorHandler: ICellValueFilterHandler;
  hasAllOfOperatorHandler: ICellValueFilterHandler;
  isWithInOperatorHandler: ICellValueFilterHandler;
  isEmptyOperatorHandler: ICellValueFilterHandler;
  isNotEmptyOperatorHandler: ICellValueFilterHandler;
}
