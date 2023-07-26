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
import type { AbstractCellValueFilter } from 'src/features/record/translator/abstract/cell-value-filter.abstract';
import type { IFieldInstance } from '../../field/model/factory';
import { BooleanCellValueFilterAdapter } from './adapter/boolean-cell-value-filter.adapter';
import { DatetimeCellValueFilterAdapter } from './adapter/datetime-cell-value-filter.adapter';
import { JsonCellValueFilterAdapter } from './adapter/json-cell-value-filter.adapter';
import { MultipleBooleanCellValueFilterAdapter } from './adapter/multiple/multiple-boolean-cell-value-filter.adapter';
import { MultipleDatetimeValueCellFilterAdapter } from './adapter/multiple/multiple-datetime-value-cell-filter.adapter';
import { MultipleJsonCellValueFilterAdapter } from './adapter/multiple/multiple-json-cell-value-filter.adapter';
import { MultipleNumberCellValueFilterAdapter } from './adapter/multiple/multiple-number-cell-value-filter.adapter';
import { MultipleStringCellValueFilterAdapter } from './adapter/multiple/multiple-string-cell-value-filter.adapter';
import { NumberCellValueFilterAdapter } from './adapter/number-cell-value-filter.adapter';
import { StringCellValueFilterAdapter } from './adapter/string-cell-value-filter.adapter';

export class FilterQueryTranslator {
  constructor(
    private readonly queryBuilder: Knex.QueryBuilder,
    private readonly fields?: { [fieldId: string]: IFieldInstance },
    private readonly filter?: IFilter | null
  ) {}

  translateToSql(): Knex.QueryBuilder {
    this.filterNullValues(this.filter);

    return this.parseFilters(this.queryBuilder, this.filter);
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
    // eslint-disable-next-line @typescript-eslint/naming-convention
    let FilterClassAdapter;
    switch (field.cellValueType) {
      case CellValueType.String:
        FilterClassAdapter = field.isMultipleCellValue
          ? field.dbFieldType === DbFieldType.Json
            ? MultipleJsonCellValueFilterAdapter
            : MultipleStringCellValueFilterAdapter
          : field.dbFieldType === DbFieldType.Json
          ? JsonCellValueFilterAdapter
          : StringCellValueFilterAdapter;
        break;
      case CellValueType.Number:
        FilterClassAdapter = field.isMultipleCellValue
          ? MultipleNumberCellValueFilterAdapter
          : NumberCellValueFilterAdapter;
        break;
      case CellValueType.DateTime:
        FilterClassAdapter = field.isMultipleCellValue
          ? MultipleDatetimeValueCellFilterAdapter
          : DatetimeCellValueFilterAdapter;
        break;
      case CellValueType.Boolean:
        FilterClassAdapter = field.isMultipleCellValue
          ? MultipleBooleanCellValueFilterAdapter
          : BooleanCellValueFilterAdapter;
        break;
    }
    return new FilterClassAdapter(this.queryBuilder, this.fields, this.filter);
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
}
