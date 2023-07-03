import type {
  FieldCore,
  IConjunction,
  IFilter,
  IFilterMeta,
  IFilterMetaOperator,
  IFilterMetaValue,
  IFilterSet,
} from '@teable-group/core';
import {
  contains,
  doesNotContain,
  getValidFilterOperators,
  is,
  isAnyOf,
  isEmpty,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isNoneOf,
  isNot,
  isNotEmpty,
} from '@teable-group/core';
import type { Knex } from 'knex';
import { includes } from 'lodash';
import { TError } from 'src/utils/catch-error';

export class FilterQueryTranslator {
  constructor(
    private readonly queryBuilder: Knex.QueryBuilder,
    private readonly fields?: { [fieldId: string]: FieldCore },
    private readonly filter?: IFilter | null
  ) {}

  private processIsOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, value);

    return queryBuilder;
  }

  private processIsNotOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.whereNot(field.dbFieldName, value);

    return queryBuilder;
  }

  private processContainsNotOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, 'like', `%${value}%`);

    return queryBuilder;
  }

  private processDoesNotContainOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.whereNot(field.dbFieldName, 'like', `%${value}%`);

    return queryBuilder;
  }

  private processIsAnyOfOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.whereIn(field.dbFieldName, value as Knex.Value[]);

    return queryBuilder;
  }

  private processIsNoneOfOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.whereNotIn(field.dbFieldName, value as Knex.Value[]);

    return queryBuilder;
  }

  private processIsGreaterOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, '>', value);

    return queryBuilder;
  }

  private processIsGreaterEqualOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, '>=', value);

    return queryBuilder;
  }

  private processIsLessOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, '<', value);

    return queryBuilder;
  }

  private processIsLessEqualOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, '<=', value);

    return queryBuilder;
  }

  private processIsEmptyOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field } = params;
    queryBuilder.whereNull(field.dbFieldName);

    return queryBuilder;
  }

  private processIsNotEmptyOperator(params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) {
    const { queryBuilder, field } = params;
    queryBuilder.whereNotNull(field.dbFieldName);

    return queryBuilder;
  }

  private filterStrategies(
    operator: IFilterMetaOperator,
    params: {
      queryBuilder: Knex.QueryBuilder;
      field: FieldCore;
      value: IFilterMetaValue;
    }
  ) {
    const operatorHandlers = {
      [is.value]: this.processIsOperator,
      [isNot.value]: this.processIsNotOperator,
      [contains.value]: this.processContainsNotOperator,
      [doesNotContain.value]: this.processDoesNotContainOperator,
      [isAnyOf.value]: this.processIsAnyOfOperator,
      [isNoneOf.value]: this.processIsNoneOfOperator,
      [isGreater.value]: this.processIsGreaterOperator,
      [isGreaterEqual.value]: this.processIsGreaterEqualOperator,
      [isLess.value]: this.processIsLessOperator,
      [isLessEqual.value]: this.processIsLessEqualOperator,
      [isEmpty.value]: this.processIsEmptyOperator,
      [isNotEmpty.value]: this.processIsNotEmptyOperator,
    };

    const chosenHandler = operatorHandlers[operator];

    if (!chosenHandler) {
      TError.internalServerError(`Unknown operator ${operator} for filter`);
    }

    return chosenHandler(params);
  }

  private parseFilter(
    queryBuilder: Knex.QueryBuilder,
    filterMeta: IFilterMeta,
    conjunction: IConjunction
  ) {
    const { fieldId, operator, value } = filterMeta;

    const field = this.fields && this.fields[fieldId];
    if (!field) {
      return queryBuilder;
    }

    const validFilterOperators = getValidFilterOperators(field);

    if (!includes(validFilterOperators, operator)) {
      TError.internalServerError(
        `Unexpected operator received: '${operator}', Field valid Operators: [${validFilterOperators}]`
      );
    }

    queryBuilder = queryBuilder[conjunction];
    this.filterStrategies(operator, { queryBuilder, field, value });

    return queryBuilder;
  }

  private parseFilters(
    queryBuilder: Knex.QueryBuilder,
    filter?: IFilter | null,
    parentConjunction?: IConjunction
  ): Knex.QueryBuilder {
    if (!filter || !filter.filterSet) {
      return queryBuilder;
    }
    const { filterSet, conjunction } = filter;

    filterSet.forEach((filterItem) => {
      if ('fieldId' in filterItem) {
        this.parseFilter(queryBuilder, filterItem as IFilterMeta, conjunction);
      } else {
        queryBuilder = queryBuilder[parentConjunction || conjunction];
        queryBuilder.where((builder) => {
          this.parseFilters(builder, filterItem as IFilterSet, conjunction);
        });
      }
    });

    return queryBuilder;
  }

  private filterNullValues(filter?: IFilter | null) {
    if (!filter) {
      return;
    }
    filter.filterSet = filter.filterSet.filter((filterItem) => {
      if ('filterSet' in filterItem) {
        this.filterNullValues(filterItem as IFilter);
        return true;
      }
      return (
        filterItem.value !== null ||
        filterItem.operator === 'isEmpty' ||
        filterItem.operator === 'isNotEmpty'
      );
    });
  }

  translateToSql(): Knex.QueryBuilder {
    this.filterNullValues(this.filter);

    return this.parseFilters(this.queryBuilder, this.filter);
  }
}
