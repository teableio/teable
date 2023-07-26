import type { IFilterOperator, IFilterValue } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../field/model/factory';

export type IFilterOperatorHandler = (
  queryBuilder: Knex.QueryBuilder,
  params: {
    field: IFieldInstance;
    operator: IFilterOperator;
    value: IFilterValue;
  }
) => Knex.QueryBuilder;

export interface IFilterOperatorHandlers {
  isOperatorHandler: IFilterOperatorHandler;
  isExactlyOperatorHandler: IFilterOperatorHandler;
  isNotOperatorHandler: IFilterOperatorHandler;
  containsOperatorHandler: IFilterOperatorHandler;
  doesNotContainOperatorHandler: IFilterOperatorHandler;
  isGreaterOperatorHandler: IFilterOperatorHandler;
  isGreaterEqualOperatorHandler: IFilterOperatorHandler;
  isLessOperatorHandler: IFilterOperatorHandler;
  isLessEqualOperatorHandler: IFilterOperatorHandler;
  isAnyOfOperatorHandler: IFilterOperatorHandler;
  isNoneOfOperatorHandler: IFilterOperatorHandler;
  hasAllOfOperatorHandler: IFilterOperatorHandler;
  isWithInOperatorHandler: IFilterOperatorHandler;
  isEmptyOperatorHandler: IFilterOperatorHandler;
  isNotEmptyOperatorHandler: IFilterOperatorHandler;
}
