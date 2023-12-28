import type { ISortItem } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../field/model/factory';

export class SortQueryTranslator {
  constructor(
    private readonly knex: Knex,
    private readonly queryBuilder: Knex.QueryBuilder,
    private readonly fields?: { [fieldId: string]: IFieldInstance },
    private readonly sortObjs?: ISortItem[]
  ) {}

  appendQueryBuilder(): Knex.QueryBuilder {
    return this.parseSorts(this.queryBuilder, this.sortObjs);
  }

  private parseSorts(queryBuilder: Knex.QueryBuilder, sortObjs?: ISortItem[]): Knex.QueryBuilder {
    if (!sortObjs) {
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
