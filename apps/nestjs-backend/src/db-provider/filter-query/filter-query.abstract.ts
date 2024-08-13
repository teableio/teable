import { BadRequestException, Logger } from '@nestjs/common';
import type {
  IConjunction,
  IDateTimeFieldOperator,
  IFilter,
  IFilterItem,
  IFilterOperator,
  IFilterSet,
  ILiteralValueList,
} from '@teable/core';
import {
  CellValueType,
  DbFieldType,
  FieldType,
  getFilterOperatorMapping,
  getValidFilterSubOperators,
  isEmpty,
  isMeTag,
  isNotEmpty,
} from '@teable/core';
import type { Knex } from 'knex';
import { includes, invert, isObject } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IFilterQueryExtra } from '../db.provider.interface';
import type { AbstractCellValueFilter } from './cell-value-filter.abstract';
import type { IFilterQueryInterface } from './filter-query.interface';

export abstract class AbstractFilterQuery implements IFilterQueryInterface {
  private logger = new Logger(AbstractFilterQuery.name);

  constructor(
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fields?: { [fieldId: string]: IFieldInstance },
    protected readonly filter?: IFilter,
    protected readonly extra?: IFilterQueryExtra
  ) {}

  appendQueryBuilder(): Knex.QueryBuilder {
    this.preProcessRemoveNullAndReplaceMe(this.filter);

    return this.parseFilters(this.originQueryBuilder, this.filter);
  }

  private parseFilters(
    queryBuilder: Knex.QueryBuilder,
    filter?: IFilter,
    parentConjunction?: IConjunction
  ): Knex.QueryBuilder {
    if (!filter || !filter.filterSet) {
      return queryBuilder;
    }
    const { filterSet, conjunction } = filter;
    queryBuilder.where((filterBuilder) => {
      filterSet.forEach((filterItem) => {
        if ('fieldId' in filterItem) {
          this.parseFilter(filterBuilder, filterItem as IFilterItem, conjunction);
        } else {
          filterBuilder = filterBuilder[parentConjunction || conjunction];
          filterBuilder.where((builder) => {
            this.parseFilters(builder, filterItem as IFilterSet, conjunction);
          });
        }
      });
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

    if (!includes(validFilterOperators, convertOperator)) {
      throw new BadRequestException(
        `The '${convertOperator}' operation provided for the '${field.name}' filter is invalid. Only the following types are allowed: [${validFilterOperators}]`
      );
    }

    const validFilterSubOperators = getValidFilterSubOperators(
      field.type,
      convertOperator as IDateTimeFieldOperator
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

    this.getFilterAdapter(field).compiler(queryBuilder, convertOperator as IFilterOperator, value);
    return queryBuilder;
  }

  private getFilterAdapter(field: IFieldInstance): AbstractCellValueFilter {
    const { dbFieldType } = field;
    switch (field.cellValueType) {
      case CellValueType.Boolean:
        return this.booleanFilter(field);
      case CellValueType.Number:
        return this.numberFilter(field);
      case CellValueType.DateTime:
        return this.dateTimeFilter(field);
      case CellValueType.String: {
        if (dbFieldType === DbFieldType.Json) {
          return this.jsonFilter(field);
        }
        return this.stringFilter(field);
      }
    }
  }

  private preProcessRemoveNullAndReplaceMe(filter?: IFilter) {
    if (!filter || !Object.keys(filter).length) {
      return;
    }

    const replaceUserId = this.extra?.withUserId;

    filter.filterSet = filter.filterSet.filter((filterItem) => {
      if ('filterSet' in filterItem) {
        this.preProcessRemoveNullAndReplaceMe(filterItem as IFilter);
        return true;
      }

      return this.processFilterItem(filterItem, replaceUserId);
    });
  }

  private processFilterItem(filterItem: IFilterItem, replaceUserId?: string): boolean {
    const { fieldId, operator, value } = filterItem;
    const field = this.fields?.[fieldId];
    if (!field) return false;

    this.replaceMeTagInValue(filterItem, field, replaceUserId);

    return this.shouldKeepFilterItem(value, field, operator);
  }

  private replaceMeTagInValue(
    filterItem: IFilterItem,
    field: IFieldInstance,
    replaceUserId?: string
  ): void {
    const { value } = filterItem;

    if (
      [FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(field.type) &&
      replaceUserId
    ) {
      filterItem.value = Array.isArray(value)
        ? (value.map((v) => (isMeTag(v as string) ? replaceUserId : v)) as ILiteralValueList)
        : isMeTag(value as string)
          ? replaceUserId
          : value;
    }
  }

  private shouldKeepFilterItem(value: unknown, field: IFieldInstance, operator: string): boolean {
    return (
      value !== null ||
      field.cellValueType === CellValueType.Boolean ||
      ([isEmpty.value, isNotEmpty.value] as string[]).includes(operator)
    );
  }

  abstract booleanFilter(field: IFieldInstance): AbstractCellValueFilter;

  abstract numberFilter(field: IFieldInstance): AbstractCellValueFilter;

  abstract dateTimeFilter(field: IFieldInstance): AbstractCellValueFilter;

  abstract stringFilter(field: IFieldInstance): AbstractCellValueFilter;

  abstract jsonFilter(field: IFieldInstance): AbstractCellValueFilter;
}
