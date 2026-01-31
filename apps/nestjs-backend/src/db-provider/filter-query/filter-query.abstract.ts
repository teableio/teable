import { Logger } from '@nestjs/common';
import type {
  FieldCore,
  IConjunction,
  IDateTimeFieldOperator,
  IFilter,
  IFilterItem,
  IFilterOperator,
  IFilterSet,
  ILiteralValueList,
  IFieldReferenceValue,
} from '@teable/core';
import {
  CellValueType,
  DbFieldType,
  FieldType,
  getFilterOperatorMapping,
  getValidFilterSubOperators,
  HttpErrorCode,
  isEmpty,
  isMeTag,
  isNotEmpty,
  isFieldReferenceValue,
} from '@teable/core';
import type { Knex } from 'knex';
import { includes, invert, isObject } from 'lodash';
import { CustomHttpException } from '../../custom.exception';
import type { IRecordQueryFilterContext } from '../../features/record/query-builder/record-query-builder.interface';
import type { IDbProvider, IFilterQueryExtra } from '../db.provider.interface';
import type { AbstractCellValueFilter } from './cell-value-filter.abstract';
import { FieldReferenceCompatibilityException } from './cell-value-filter.abstract';
import type { IFilterQueryInterface } from './filter-query.interface';

export abstract class AbstractFilterQuery implements IFilterQueryInterface {
  private logger = new Logger(AbstractFilterQuery.name);

  constructor(
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fields?: { [fieldId: string]: FieldCore },
    protected readonly filter?: IFilter,
    protected readonly extra?: IFilterQueryExtra,
    protected readonly dbProvider?: IDbProvider,
    protected readonly context?: IRecordQueryFilterContext
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
      let referenceFieldId: string | undefined;
      if (isFieldReferenceValue(value)) {
        referenceFieldId = value.fieldId;
      } else if (Array.isArray(value)) {
        referenceFieldId = (
          value.find((entry) => isFieldReferenceValue(entry)) as IFieldReferenceValue | undefined
        )?.fieldId;
      }

      if (referenceFieldId) {
        const referenceName = this.fields?.[referenceFieldId]?.name ?? referenceFieldId;
        const sourceName = field.name ?? field.id;
        throw new FieldReferenceCompatibilityException(sourceName, referenceName);
      }

      throw new CustomHttpException(
        `The '${convertOperator}' operation provided for the '${field.name}' filter is invalid. Only the following types are allowed: [${validFilterOperators}]`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.view.filterInvalidOperator',
          },
        }
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
      throw new CustomHttpException(
        `The '${convertOperator}' operation provided for the '${field.name}' filter is invalid. Only the following subtypes are allowed: [${validFilterSubOperators}]`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.view.filterInvalidOperatorMode',
          },
        }
      );
    }

    queryBuilder = queryBuilder[conjunction];

    this.getFilterAdapter(field).compiler(
      queryBuilder,
      convertOperator as IFilterOperator,
      value,
      this.dbProvider!
    );
    return queryBuilder;
  }

  private getFilterAdapter(field: FieldCore): AbstractCellValueFilter {
    const { dbFieldType } = field;
    switch (field.cellValueType) {
      case CellValueType.Boolean:
        return this.booleanFilter(field, this.context);
      case CellValueType.Number:
        return this.numberFilter(field, this.context);
      case CellValueType.DateTime:
        return this.dateTimeFilter(field, this.context);
      case CellValueType.String: {
        if (dbFieldType === DbFieldType.Json) {
          return this.jsonFilter(field, this.context);
        }
        return this.stringFilter(field, this.context);
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
    field: FieldCore,
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

  private shouldKeepFilterItem(value: unknown, field: FieldCore, operator: string): boolean {
    return (
      value !== null ||
      field.cellValueType === CellValueType.Boolean ||
      ([isEmpty.value, isNotEmpty.value] as string[]).includes(operator)
    );
  }

  abstract booleanFilter(
    field: FieldCore,
    context?: IRecordQueryFilterContext
  ): AbstractCellValueFilter;

  abstract numberFilter(
    field: FieldCore,
    context?: IRecordQueryFilterContext
  ): AbstractCellValueFilter;

  abstract dateTimeFilter(
    field: FieldCore,
    context?: IRecordQueryFilterContext
  ): AbstractCellValueFilter;

  abstract stringFilter(
    field: FieldCore,
    context?: IRecordQueryFilterContext
  ): AbstractCellValueFilter;

  abstract jsonFilter(
    field: FieldCore,
    context?: IRecordQueryFilterContext
  ): AbstractCellValueFilter;
}
