import type { IFilterOperator, IFilterValue } from '@teable/core';
import type { Knex } from 'knex';

export type ICellValueFilterHandler = (
  builderClient: Knex.QueryBuilder,
  operator: IFilterOperator,
  value: IFilterValue
) => Knex.QueryBuilder;

export interface ICellValueFilterInterface {
  isOperatorHandler: ICellValueFilterHandler;
  isExactlyOperatorHandler: ICellValueFilterHandler;
  isNotOperatorHandler: ICellValueFilterHandler;
  isNotExactlyOperatorHandler: ICellValueFilterHandler;
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
