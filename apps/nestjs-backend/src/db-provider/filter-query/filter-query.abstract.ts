import { BadRequestException, Logger } from '@nestjs/common';
import type {
  FieldCore,
  IConjunction,
  IFilterValidationError,
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
  analyzeFilterValidationIssues,
  getFilterOperatorMapping,
  isEmpty,
  isMeTag,
  isNotEmpty,
  isFieldReferenceValue,
} from '@teable/core';
import type { Knex } from 'knex';
import { includes, invert } from 'lodash';
import { ZodError } from 'zod';
import type { IRecordQueryFilterContext } from '../../features/record/query-builder/record-query-builder.interface';
import type { IDbProvider, IFilterQueryExtra } from '../db.provider.interface';
import type { AbstractCellValueFilter } from './cell-value-filter.abstract';
import { FieldReferenceCompatibilityException } from './cell-value-filter.abstract';
import type { IFilterQueryInterface } from './filter-query.interface';

export abstract class AbstractFilterQuery implements IFilterQueryInterface {
  private logger = new Logger(AbstractFilterQuery.name);
  private filterValidationIssueMap = new Map<string, IFilterValidationError[]>();

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
    this.filterValidationIssueMap = this.collectFilterValidationIssues(this.filter);

    return this.parseFilters(this.originQueryBuilder, this.filter);
  }

  private parseFilters(
    queryBuilder: Knex.QueryBuilder,
    filter?: IFilter,
    parentConjunction?: IConjunction,
    path: number[] = []
  ): Knex.QueryBuilder {
    if (!filter || !filter.filterSet) {
      return queryBuilder;
    }
    const { filterSet, conjunction } = filter;
    queryBuilder.where((filterBuilder) => {
      filterSet.forEach((filterItem, index) => {
        const itemPath = [...path, index];
        if ('fieldId' in filterItem) {
          this.parseFilter(filterBuilder, filterItem as IFilterItem, conjunction, itemPath);
        } else {
          filterBuilder = filterBuilder[parentConjunction || conjunction];
          filterBuilder.where((builder) => {
            this.parseFilters(builder, filterItem as IFilterSet, conjunction, itemPath);
          });
        }
      });
    });

    return queryBuilder;
  }

  private parseFilter(
    queryBuilder: Knex.QueryBuilder,
    filterMeta: IFilterItem,
    conjunction: IConjunction,
    path: number[]
  ) {
    const { fieldId, operator, value, isSymbol } = filterMeta;

    const field = this.fields && this.fields[fieldId];
    if (!field) {
      return queryBuilder;
    }

    if (this.shouldSkipInvalidFilterItem(field, filterMeta, path)) {
      return queryBuilder;
    }

    const convertOperator = this.getConvertedOperator(field, operator, isSymbol);
    const validFilterOperators = Object.keys(getFilterOperatorMapping(field));

    if (!includes(validFilterOperators, convertOperator)) {
      this.throwIfFilterReferencesInvalidOperator(field, value);
      this.logger.warn(
        `Skip filter item: field=${field.id}(${field.name}) operator='${convertOperator}' not in [${validFilterOperators.join(',')}]`
      );
      return queryBuilder;
    }

    queryBuilder = queryBuilder[conjunction];

    try {
      this.getFilterAdapter(field).compiler(
        queryBuilder,
        convertOperator as IFilterOperator,
        value,
        this.dbProvider!
      );
    } catch (error) {
      this.handleCompilerError(error, field, convertOperator, value);
    }
    return queryBuilder;
  }

  private shouldSkipInvalidFilterItem(field: FieldCore, filterMeta: IFilterItem, path: number[]) {
    const validationIssues = this.getFilterItemValidationIssues(path);
    if (validationIssues.length === 0) {
      return false;
    }

    const hasInvalidOperator = validationIssues.some(
      (issue) => issue.code === 'OPERATOR_NOT_ALLOWED'
    );
    if (hasInvalidOperator) {
      this.throwIfFilterReferencesInvalidOperator(field, filterMeta.value);
    }

    this.logger.warn(
      `Skip filter item: field=${field.id}(${field.name}) path=${path.join('.')} issues=[${validationIssues
        .map((issue) => issue.code)
        .join(',')}]`
    );
    return true;
  }

  private getConvertedOperator(field: FieldCore, operator: string, isSymbol?: boolean) {
    if (!isSymbol) {
      return operator as IFilterOperator;
    }

    return invert(getFilterOperatorMapping(field))[operator] as IFilterOperator;
  }

  private throwIfFilterReferencesInvalidOperator(field: FieldCore, value: unknown) {
    const referenceFieldId = this.extractFieldReferenceFieldId(value);
    if (!referenceFieldId) {
      return;
    }

    const referenceName = this.fields?.[referenceFieldId]?.name ?? referenceFieldId;
    const sourceName = field.name ?? field.id;
    throw new FieldReferenceCompatibilityException(sourceName, referenceName);
  }

  private handleCompilerError(
    error: unknown,
    field: FieldCore,
    convertOperator: IFilterOperator,
    value: unknown
  ) {
    if (error instanceof FieldReferenceCompatibilityException) {
      throw error;
    }
    if (this.extractFieldReferenceFieldId(value)) {
      throw error;
    }
    if (!this.isSkippableCompilerError(error)) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Skip filter item: field=${field.id}(${field.name}) operator='${convertOperator}' ` +
        `value=${JSON.stringify(value)} compile error: ${reason}`
    );
  }

  private collectFilterValidationIssues(filter?: IFilter) {
    const issueMap = new Map<string, IFilterValidationError[]>();
    if (!filter || !this.fields) {
      return issueMap;
    }

    const fieldMetaMap = Object.entries(this.fields).reduce(
      (acc, [fieldKey, field]) => {
        const fieldMeta = {
          type: field.type,
          cellValueType: field.cellValueType,
          isMultipleCellValue: Boolean(field.isMultipleCellValue),
        };
        acc[fieldKey] = fieldMeta;
        acc[field.id] = fieldMeta;
        return acc;
      },
      {} as Record<
        string,
        {
          type: FieldType;
          cellValueType: CellValueType;
          isMultipleCellValue: boolean;
        }
      >
    );

    const issues = analyzeFilterValidationIssues(filter, fieldMetaMap);
    issues.forEach((issue) => {
      const key = issue.path.join('.');
      const issueList = issueMap.get(key) ?? [];
      issueList.push(issue);
      issueMap.set(key, issueList);
    });
    return issueMap;
  }

  private getFilterItemValidationIssues(path: number[]) {
    return this.filterValidationIssueMap.get(path.join('.')) ?? [];
  }

  private extractFieldReferenceFieldId(value: unknown): string | undefined {
    if (isFieldReferenceValue(value)) {
      return value.fieldId;
    }
    if (Array.isArray(value)) {
      return (
        value.find((entry) => isFieldReferenceValue(entry)) as IFieldReferenceValue | undefined
      )?.fieldId;
    }
    return undefined;
  }

  private isSkippableCompilerError(error: unknown) {
    return error instanceof BadRequestException || error instanceof ZodError;
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
