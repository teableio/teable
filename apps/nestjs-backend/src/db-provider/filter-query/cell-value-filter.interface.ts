import type { IFilterOperator, IFilterValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../db.provider.interface';

export type ICellValueFilterHandler = (
  builderClient: Knex.QueryBuilder,
  operator: IFilterOperator,
  value: IFilterValue,
  dbProvider: IDbProvider
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
