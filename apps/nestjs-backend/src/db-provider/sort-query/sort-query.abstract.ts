import { Logger } from '@nestjs/common';
import type { FieldCore, ISortItem } from '@teable/core';
import { CellValueType, DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import type { IRecordQuerySortContext } from '../../features/record/query-builder/record-query-builder.interface';
import type { ISortQueryExtra } from '../db.provider.interface';
import type { AbstractSortFunction } from './function/sort-function.abstract';
import type { ISortQueryInterface } from './sort-query.interface';

export abstract class AbstractSortQuery implements ISortQueryInterface {
  private logger = new Logger(AbstractSortQuery.name);

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
    let sortSQLText = sortObjs
      .map(({ fieldId, order }) => {
        const field = (this.fields && this.fields[fieldId]) as FieldCore;

        return this.getSortAdapter(field).generateSQL(order);
      })
      .join();

    sortSQLText += `, ${defaultSortSql}`;
    return sortSQLText;
  }

  private parseSorts(queryBuilder: Knex.QueryBuilder, sortObjs?: ISortItem[]): Knex.QueryBuilder {
    if (!sortObjs || !sortObjs.length) {
      return queryBuilder;
    }

    sortObjs.forEach(({ fieldId, order }) => {
      const field = this.fields && this.fields[fieldId];
      if (!field) {
        return queryBuilder;
      }

      this.getSortAdapter(field).compiler(queryBuilder, order);
    });

    return queryBuilder;
  }

  private getSortAdapter(field: FieldCore): AbstractSortFunction {
    const { dbFieldType } = field;
    switch (field.cellValueType) {
      case CellValueType.Boolean:
        return this.booleanSort(field, this.context);
      case CellValueType.Number:
        return this.numberSort(field, this.context);
      case CellValueType.DateTime:
        return this.dateTimeSort(field, this.context);
      case CellValueType.String: {
        if (dbFieldType === DbFieldType.Json) {
          return this.jsonSort(field, this.context);
        }
        return this.stringSort(field, this.context);
      }
    }
  }

  abstract booleanSort(field: FieldCore, context?: IRecordQuerySortContext): AbstractSortFunction;

  abstract numberSort(field: FieldCore, context?: IRecordQuerySortContext): AbstractSortFunction;

  abstract dateTimeSort(field: FieldCore, context?: IRecordQuerySortContext): AbstractSortFunction;

  abstract stringSort(field: FieldCore, context?: IRecordQuerySortContext): AbstractSortFunction;

  abstract jsonSort(field: FieldCore, context?: IRecordQuerySortContext): AbstractSortFunction;
}
