import { TimeFormatting } from '@teable/core';
import type { INumberFieldOptions, IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import { getOffset } from '../search-query/get-offset';
import { AbstractGroupQuery } from './group-query.abstract';
import type { IGroupQueryExtra } from './group-query.interface';

export class GroupQuerySqlite extends AbstractGroupQuery {
  constructor(
    protected readonly knex: Knex,
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fieldMap?: { [fieldId: string]: IFieldInstance },
    protected readonly groupFieldIds?: string[],
    protected readonly extra?: IGroupQueryExtra
  ) {
    super(knex, originQueryBuilder, fieldMap, groupFieldIds, extra);
  }

  private get isDistinct() {
    const { isDistinct } = this.extra ?? {};
    return isDistinct;
  }

  string(field: IFieldInstance): Knex.QueryBuilder {
    if (!field) return this.originQueryBuilder;

    const { dbFieldName } = field;
    const column = this.knex.ref(dbFieldName);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(dbFieldName);
    }
    return this.originQueryBuilder.select(column).groupBy(dbFieldName);
  }

  number(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const column = this.knex.raw('ROUND(??, ?) as ??', [dbFieldName, precision, dbFieldName]);
    const groupByColumn = this.knex.raw('ROUND(??, ?)', [dbFieldName, precision]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  date(field: IFieldInstance): Knex.QueryBuilder {
    if (!field) return this.originQueryBuilder;

    const { dbFieldName, options } = field;
    const { time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      const column = this.knex.ref(dbFieldName);
      return this.isDistinct
        ? this.originQueryBuilder.countDistinct(dbFieldName)
        : this.originQueryBuilder.select(column).groupBy(dbFieldName);
    }

    const offsetStr = `${getOffset(timeZone)} hour`;
    const column = this.knex.raw('DATE(??, ?) as ??', [dbFieldName, offsetStr, dbFieldName]);
    const groupByColumn = this.knex.raw('DATE(??, ?)', [dbFieldName, offsetStr]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  json(field: IFieldInstance): Knex.QueryBuilder {
    if (!field) return this.originQueryBuilder;

    const { dbFieldName } = field;
    const column = this.knex.raw(`CAST(?? as text) as ??`, [dbFieldName, dbFieldName]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(dbFieldName);
    }
    return this.originQueryBuilder.select(column).groupBy(dbFieldName);
  }

  multipleDate(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      const column = this.knex.ref(dbFieldName);
      return this.isDistinct
        ? this.originQueryBuilder.countDistinct(dbFieldName)
        : this.originQueryBuilder.select(column).groupBy(dbFieldName);
    }

    const offsetStr = `${getOffset(timeZone)} hour`;
    const column = this.knex.raw(
      `
      (
        SELECT json_group_array(DATE(value, ?))
        FROM json_each(??)
      ) as ??
      `,
      [offsetStr, dbFieldName, dbFieldName]
    );
    const groupByColumn = this.knex.raw(
      `
      (
        SELECT json_group_array(DATE(value, ?))
        FROM json_each(??)
      )
      `,
      [offsetStr, dbFieldName]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  multipleNumber(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const column = this.knex.raw(
      `
      (
        SELECT json_group_array(ROUND(value, ?))
        FROM json_each(??)
      ) as ??
      `,
      [precision, dbFieldName, dbFieldName]
    );
    const groupByColumn = this.knex.raw(
      `
      (
        SELECT json_group_array(ROUND(value, ?))
        FROM json_each(??)
      )
      `,
      [precision, dbFieldName]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }
}
