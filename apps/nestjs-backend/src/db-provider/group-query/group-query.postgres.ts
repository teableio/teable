import { TimeFormatting } from '@teable/core';
import type { INumberFieldOptions, IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import { AbstractGroupQuery } from './group-query.abstract';
import type { IGroupQueryExtra } from './group-query.interface';

export class GroupQueryPostgres extends AbstractGroupQuery {
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
    const { dbFieldName } = field;
    const column = this.knex.ref(dbFieldName);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(dbFieldName);
    }
    return this.originQueryBuilder.select(column).groupBy(dbFieldName);
  }

  number(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { precision = 0 } = (options as INumberFieldOptions).formatting ?? {};
    const column = this.knex.raw('ROUND(??::numeric, ?)::float as ??', [
      dbFieldName,
      precision,
      dbFieldName,
    ]);
    const groupByColumn = this.knex.raw('ROUND(??::numeric, ?)::float', [dbFieldName, precision]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  date(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      const column = this.knex.ref(dbFieldName);
      return this.isDistinct
        ? this.originQueryBuilder.countDistinct(dbFieldName)
        : this.originQueryBuilder.select(column).groupBy(dbFieldName);
    }

    const format = date;
    const column = this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), '${format}') as ??`, [
      timeZone,
      dbFieldName,
      dbFieldName,
    ]);
    const groupByColumn = this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), '${format}')`, [
      timeZone,
      dbFieldName,
    ]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  json(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName } = field;
    const column = this.knex.raw(`CAST(?? as text)`, [dbFieldName]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(dbFieldName);
    }
    return this.originQueryBuilder.select(column).groupBy(dbFieldName);
  }

  multipleDate(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      const column = this.knex.ref(dbFieldName);
      return this.isDistinct
        ? this.originQueryBuilder.countDistinct(dbFieldName)
        : this.originQueryBuilder.select(column).groupBy(dbFieldName);
    }

    const format = date;
    const column = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), '${format}')))
      FROM jsonb_array_elements_text(??::jsonb) as elem) as ??
      `,
      [timeZone, dbFieldName, dbFieldName]
    );
    const groupByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), '${format}')))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      `,
      [timeZone, dbFieldName]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  multipleNumber(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { precision = 0 } = (options as INumberFieldOptions).formatting ?? {};
    const column = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
      FROM jsonb_array_elements_text(??::jsonb) as elem) as ??
      `,
      [precision, dbFieldName, dbFieldName]
    );
    const groupByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      `,
      [precision, dbFieldName]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }
}
