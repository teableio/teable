import { Logger } from '@nestjs/common';
import type { ISortItem } from '@teable/core';
import { CellValueType, DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { ISortQueryExtra } from '../db.provider.interface';
import type { AbstractSortFunction } from './function/sort-function.abstract';
import type { ISortQueryInterface } from './sort-query.interface';

export abstract class AbstractSortQuery implements ISortQueryInterface {
  private logger = new Logger(AbstractSortQuery.name);

  constructor(
    protected readonly knex: Knex,
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fields?: { [fieldId: string]: IFieldInstance },
    protected readonly sortObjs?: ISortItem[],
    protected readonly extra?: ISortQueryExtra
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
        const field = (this.fields && this.fields[fieldId]) as IFieldInstance;

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

  private getSortAdapter(field: IFieldInstance): AbstractSortFunction {
    const { dbFieldType } = field;
    switch (field.cellValueType) {
      case CellValueType.Boolean:
        return this.booleanSort(field);
      case CellValueType.Number:
        return this.numberSort(field);
      case CellValueType.DateTime:
        return this.dateTimeSort(field);
      case CellValueType.String: {
        if (dbFieldType === DbFieldType.Json) {
          return this.jsonSort(field);
        }
        return this.stringSort(field);
      }
    }
  }

  abstract booleanSort(field: IFieldInstance): AbstractSortFunction;

  abstract numberSort(field: IFieldInstance): AbstractSortFunction;

  abstract dateTimeSort(field: IFieldInstance): AbstractSortFunction;

  abstract stringSort(field: IFieldInstance): AbstractSortFunction;

  abstract jsonSort(field: IFieldInstance): AbstractSortFunction;
}
