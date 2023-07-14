import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
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
  getFilterOperatorMapping,
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  is,
  isAnyOf,
  isEmpty,
  isExactly,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isNoneOf,
  isNot,
  isNotEmpty,
} from '@teable-group/core';
import type { Knex } from 'knex';
import { get, includes, invert, isArray, size } from 'lodash';

export class FilterQueryTranslator {
  private readonly _table: string;

  constructor(
    private readonly queryBuilder: Knex.QueryBuilder,
    private readonly fields?: { [fieldId: string]: FieldCore },
    private readonly filter?: IFilter | null
  ) {
    this._table = get(queryBuilder, ['_single', 'table']);
  }

  private processIsOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.isMultipleCellValue && isArray(value)) {
      const placeholders = value.map(() => '?').join(',');
      const isExactlySql = `(
        select count(distinct json_each.value) from 
          json_each(${this._table}.${field.dbFieldName}) 
        where json_each.value in (${placeholders})
          and json_array_length(${this._table}.${field.dbFieldName}) = ?
      ) = ?`;
      const vLength = value.length;
      queryBuilder.whereRaw(isExactlySql, [...value, vLength, vLength]);
    } else {
      queryBuilder.where(field.dbFieldName, value);
    }

    return queryBuilder;
  };

  private processIsNotOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.whereNot(field.dbFieldName, value);

    return queryBuilder;
  };

  private processContainsNotOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, 'like', `%${value}%`);

    return queryBuilder;
  };

  private processDoesNotContainOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.whereNot(field.dbFieldName, 'like', `%${value}%`);

    return queryBuilder;
  };

  private processIsGreaterOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, '>', value);

    return queryBuilder;
  };

  private processIsGreaterEqualOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, '>=', value);

    return queryBuilder;
  };

  private processIsLessOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, '<', value);

    return queryBuilder;
  };

  private processIsLessEqualOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, '<=', value);

    return queryBuilder;
  };

  private processIsEmptyOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field } = params;
    queryBuilder.whereNull(field.dbFieldName);

    return queryBuilder;
  };

  private processIsNotEmptyOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field } = params;
    queryBuilder.whereNotNull(field.dbFieldName);

    return queryBuilder;
  };

  private processIsAnyOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    if (!isArray(value)) {
      throw new BadRequestException('value must be an array');
    }

    if (field.isMultipleCellValue) {
      const placeholders = value.map(() => '?').join(',');
      const hasAnyOfSql = `exists (
              select 1 from
                json_each(${this._table}.${field.dbFieldName})
              where json_each.value in (${placeholders})
            )`;
      queryBuilder.whereRaw(hasAnyOfSql, [...value]);
    } else {
      queryBuilder.whereIn(field.dbFieldName, value);
    }

    return queryBuilder;
  };

  private processIsNoneOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    if (!isArray(value)) {
      throw new BadRequestException('value must be an array');
    }

    if (field.isMultipleCellValue) {
      const placeholders = value.map(() => '?').join(',');
      const hasNoneOfSql = `not exists (
              select 1 from
                json_each(${this._table}.${field.dbFieldName})
              where json_each.value in (${placeholders})
            )`;
      queryBuilder.whereRaw(hasNoneOfSql, [...value]);
    } else {
      queryBuilder.whereNotIn(field.dbFieldName, value);
    }

    return queryBuilder;
  };

  private processHasAllOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.isMultipleCellValue && isArray(value)) {
      const placeholders = value.map(() => '?').join(',');
      const hasAllSql = `(
          select count(distinct json_each.value) from 
            json_each(${this._table}.${field.dbFieldName}) 
          where json_each.value in (${placeholders})
        ) = ?`;
      queryBuilder.whereRaw(hasAllSql, [...value, size(value)]);
    }

    return queryBuilder;
  };

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
      [isExactly.value]: this.processIsOperator,

      [isNot.value]: this.processIsNotOperator,
      [contains.value]: this.processContainsNotOperator,
      [doesNotContain.value]: this.processDoesNotContainOperator,
      [isGreater.value]: this.processIsGreaterOperator,
      [isGreaterEqual.value]: this.processIsGreaterEqualOperator,
      [isLess.value]: this.processIsLessOperator,
      [isLessEqual.value]: this.processIsLessEqualOperator,
      [isEmpty.value]: this.processIsEmptyOperator,
      [isNotEmpty.value]: this.processIsNotEmptyOperator,

      [isAnyOf.value]: this.processIsAnyOfOperator,
      [hasAnyOf.value]: this.processIsAnyOfOperator,

      [isNoneOf.value]: this.processIsNoneOfOperator,
      [hasNoneOf.value]: this.processIsNoneOfOperator,

      [hasAllOf.value]: this.processHasAllOfOperator,
    };

    const chosenHandler = operatorHandlers[operator];

    if (!chosenHandler) {
      throw new InternalServerErrorException(`Unknown operator ${operator} for filter`);
    }

    return chosenHandler(params);
  }

  private parseFilter(
    queryBuilder: Knex.QueryBuilder,
    filterMeta: IFilterMeta,
    conjunction: IConjunction
  ) {
    const { fieldId, operator, value, isSymbol } = filterMeta;

    const field = this.fields && this.fields[fieldId];
    if (!field) {
      return queryBuilder;
    }

    let convertOperator = operator;
    const filterOperatorMapping = getFilterOperatorMapping(field);
    const validFilterOperators = Object.keys(filterOperatorMapping);
    if (isSymbol) {
      convertOperator = invert(filterOperatorMapping)[operator] as IFilterMetaOperator;
    }

    if (!includes(validFilterOperators, operator)) {
      throw new InternalServerErrorException(
        `Unexpected operator received: '${convertOperator}', Field valid Operators: [${validFilterOperators}]`
      );
    }

    queryBuilder = queryBuilder[conjunction];
    this.filterStrategies(convertOperator as IFilterMetaOperator, { queryBuilder, field, value });

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
    if (!filter || !Object.keys(filter).length) {
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
