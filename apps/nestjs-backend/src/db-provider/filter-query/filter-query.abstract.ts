import { BadRequestException } from '@nestjs/common';
import type {
  IConjunction,
  IDateTimeFieldOperator,
  IFilter,
  IFilterItem,
  IFilterOperator,
  IFilterSet,
} from '@teable-group/core';
import {
  CellValueType,
  DbFieldType,
  FieldType,
  getFilterOperatorMapping,
  getValidFilterSubOperators,
  isEmpty,
  isNotEmpty,
} from '@teable-group/core';
import type { Knex } from 'knex';
import { includes, invert, isObject } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { AbstractCellValueFilter } from './cell-value-filter.abstract';
import type { IFilterQueryInterface } from './filter-query.interface';

export abstract class AbstractFilterQuery implements IFilterQueryInterface {
  constructor(
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fields?: { [p: string]: IFieldInstance },
    protected readonly filter?: IFilter | null
  ) {}

  appendQueryBuilder(): Knex.QueryBuilder {
    this.filterNullValues(this.filter);

    return this.parseFilters(this.originQueryBuilder, this.filter);
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
        this.parseFilter(queryBuilder, filterItem as IFilterItem, conjunction);
      } else {
        queryBuilder = queryBuilder[parentConjunction || conjunction];
        queryBuilder.where((builder) => {
          this.parseFilters(builder, filterItem as IFilterSet, conjunction);
        });
      }
    });

    return queryBuilder;
  }

  private parseFilter(
    queryBuilder: Knex.QueryBuilder,
    filterMeta: IFilterItem,
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
      convertOperator = invert(filterOperatorMapping)[operator] as IFilterOperator;
    }

    if (!includes(validFilterOperators, operator)) {
      throw new BadRequestException(
        `The '${convertOperator}' operation provided for the '${field.name}' filter is invalid. Only the following types are allowed: [${validFilterOperators}]`
      );
    }

    const validFilterSubOperators = getValidFilterSubOperators(
      field.type,
      operator as IDateTimeFieldOperator
    );

    if (
      validFilterSubOperators &&
      isObject(value) &&
      'mode' in value &&
      !includes(validFilterSubOperators, value.mode)
    ) {
      throw new BadRequestException(
        `The '${convertOperator}' operation provided for the '${field.name}' filter is invalid. Only the following subtypes are allowed: [${validFilterSubOperators}]`
      );
    }

    queryBuilder = queryBuilder[conjunction];
    this.getFilterAdapter(field).filterStrategies(convertOperator as IFilterOperator, {
      queryBuilder,
      field,
      value,
    });
    return queryBuilder;
  }

  private getFilterAdapter(field: IFieldInstance): AbstractCellValueFilter {
    const { isMultipleCellValue, dbFieldType } = field;
    switch (field.cellValueType) {
      case CellValueType.Boolean:
        return this.booleanFilter(isMultipleCellValue);
      case CellValueType.Number:
        return this.numberFilter(isMultipleCellValue);
      case CellValueType.DateTime:
        return this.dateTimeFilter(isMultipleCellValue);
      case CellValueType.String: {
        if (dbFieldType === DbFieldType.Json) {
          return this.jsonFilter(isMultipleCellValue);
        }
        return this.stringFilter(isMultipleCellValue);
      }
    }
  }

  private filterNullValues(filter?: IFilter | null) {
    // If the filter is not defined or has no keys, exit the function
    if (!filter || !Object.keys(filter).length) {
      return;
    }
    filter.filterSet = filter.filterSet.filter((filterItem) => {
      // If 'filterSet' exists in filterItem, recursively call filterNullValues
      // Always keep the filterItem, as we are modifying it in-place
      if ('filterSet' in filterItem) {
        this.filterNullValues(filterItem as IFilter);
        return true;
      }
      const { fieldId, operator, value } = filterItem;
      // Get the corresponding field from the fields object using fieldId
      // If it doesn't exist, filter out the item
      const field = this.fields?.[fieldId];
      if (!field) return false;

      // Keep the filterItem if any of the following conditions are met:
      // - The value is not null
      // - The field type is a checkbox
      // - The operator is either 'isEmpty' or 'isNotEmpty'
      return (
        value !== null ||
        field.type === FieldType.Checkbox ||
        ([isEmpty.value, isNotEmpty.value] as string[]).includes(operator)
      );
    });
  }

  abstract booleanFilter(isMultipleCellValue?: boolean): AbstractCellValueFilter;

  abstract numberFilter(isMultipleCellValue?: boolean): AbstractCellValueFilter;

  abstract dateTimeFilter(isMultipleCellValue?: boolean): AbstractCellValueFilter;

  abstract stringFilter(isMultipleCellValue?: boolean): AbstractCellValueFilter;

  abstract jsonFilter(isMultipleCellValue?: boolean): AbstractCellValueFilter;
}
