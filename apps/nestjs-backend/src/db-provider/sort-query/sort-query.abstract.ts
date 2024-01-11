import { Logger } from '@nestjs/common';
import type { ISortItem } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { ISortQueryExtra } from '../db.provider.interface';
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

  private parseSorts(queryBuilder: Knex.QueryBuilder, sortObjs?: ISortItem[]): Knex.QueryBuilder {
    if (!sortObjs || !sortObjs.length) {
      return queryBuilder;
    }

    sortObjs.forEach((sort) => {
      const { fieldId, order } = sort;

      const field = this.fields && this.fields[fieldId];
      if (!field) {
        return queryBuilder;
      }

      const column =
        field.dbFieldType === 'JSON'
          ? this.knex.raw(`CAST(?? as text)`, [field.dbFieldName]).toQuery()
          : this.knex.ref(field.dbFieldName).toQuery();

      const nulls = order.toUpperCase() === 'ASC' ? 'FIRST' : 'LAST';

      queryBuilder.orderByRaw(this.knex.raw(`${column} ${order} NULLS ${nulls}`).toQuery());
    });

    return queryBuilder;
  }
}
