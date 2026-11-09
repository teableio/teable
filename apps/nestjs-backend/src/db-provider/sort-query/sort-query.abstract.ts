import { BadRequestException, Logger } from '@nestjs/common';
import type { FieldCore, ISortItem } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type { Knex } from 'knex';
import type { IRecordQuerySortContext } from '../../features/record/query-builder/record-query-builder.interface';
import type { ISortQueryExtra } from '../db.provider.interface';
import type { AbstractSortFunction } from './function/sort-function.abstract';
import type { ISortQueryInterface } from './sort-query.interface';

export abstract class AbstractSortQuery implements ISortQueryInterface {
  private readonly logger = new Logger(AbstractSortQuery.name);

  constructor(
    protected readonly knex: Knex,
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fields?: { [fieldId: string]: FieldCore },
    protected readonly sortObjs?: ISortItem[],
    protected readonly extra?: ISortQueryExtra,
    protected readonly context?: IRecordQuerySortContext
  ) {}

  appendSortBuilder(): Knex.QueryBuilder {
    return this.parseSorts(this.originQueryBuilder, this.sortObjs);
  }

  getRawSortSQLText(): string {
    return this.genSortSQL(this.sortObjs);
  }

  private genSortSQL(sortObjs?: ISortItem[]) {
    const defaultSortSql = this.knex.raw(`?? ASC`, ['__auto_number']).toQuery();
    if (!sortObjs?.length) {
      return defaultSortSql;
    }
    const sortClauses = sortObjs
      .map(({ fieldId, order, collation }) => {
        const field = this.fields?.[fieldId];
        if (!field) {
          if (collation !== undefined) {
            throw new BadRequestException(`Field ${fieldId} not found for collated sort`);
          }
          return undefined;
        }
        return this.getSortAdapter(field, collation).generateSQL(order);
      })
      .filter((clause): clause is string => typeof clause === 'string' && clause.length > 0);

    if (!sortClauses.length) {
      return defaultSortSql;
    }

    sortClauses.push(defaultSortSql);
    return sortClauses.join(', ');
  }

  private parseSorts(queryBuilder: Knex.QueryBuilder, sortObjs?: ISortItem[]): Knex.QueryBuilder {
    if (!sortObjs?.length) {
      return queryBuilder;
    }

    sortObjs.forEach(({ fieldId, order, collation }) => {
      const field = this.fields?.[fieldId];
      if (!field) {
        if (collation !== undefined) {
          throw new BadRequestException(`Field ${fieldId} not found for collated sort`);
        }
        return;
      }

      this.getSortAdapter(field, collation).compiler(queryBuilder, order);
    });

    return queryBuilder;
  }

  private getSortAdapter(
    field: FieldCore,
    collation?: ISortItem['collation']
  ): AbstractSortFunction {
    this.assertSupportedCollation(field, collation);
    const { dbFieldType } = field;
    switch (field.cellValueType) {
      case CellValueType.Boolean:
        return this.booleanSort(field, this.context, collation);
      case CellValueType.Number:
        return this.numberSort(field, this.context, collation);
      case CellValueType.DateTime:
        return this.dateTimeSort(field, this.context, collation);
      case CellValueType.String: {
        if (dbFieldType === DbFieldType.Json) {
          return this.jsonSort(field, this.context, collation);
        }
        return this.stringSort(field, this.context, collation);
      }
    }
  }

  private assertSupportedCollation(field: FieldCore, collation?: ISortItem['collation']): void {
    if (collation === undefined) {
      return;
    }

    const isNativeText =
      (field.type === FieldType.SingleLineText || field.type === FieldType.LongText) &&
      field.dbFieldType === DbFieldType.Text &&
      !field.isComputed &&
      !field.isMultipleCellValue;
    const isSingleValueLink =
      field.type === FieldType.Link &&
      field.dbFieldType === DbFieldType.Json &&
      !field.isMultipleCellValue;
    if (collation === 'zh-pinyin' && (isNativeText || isSingleValueLink)) {
      return;
    }

    throw new BadRequestException(
      `Collation ${collation} is not supported for field ${field.id} (${field.type})`
    );
  }

  abstract booleanSort(
    field: FieldCore,
    context?: IRecordQuerySortContext,
    collation?: ISortItem['collation']
  ): AbstractSortFunction;

  abstract numberSort(
    field: FieldCore,
    context?: IRecordQuerySortContext,
    collation?: ISortItem['collation']
  ): AbstractSortFunction;

  abstract dateTimeSort(
    field: FieldCore,
    context?: IRecordQuerySortContext,
    collation?: ISortItem['collation']
  ): AbstractSortFunction;

  abstract stringSort(
    field: FieldCore,
    context?: IRecordQuerySortContext,
    collation?: ISortItem['collation']
  ): AbstractSortFunction;

  abstract jsonSort(
    field: FieldCore,
    context?: IRecordQuerySortContext,
    collation?: ISortItem['collation']
  ): AbstractSortFunction;
}
