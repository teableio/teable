import { TimeFormatting, type IDateFieldOptions } from '@teable/core';
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

  string(field: IFieldInstance): Knex.QueryBuilder {
    if (!field) return this.originQueryBuilder;

    const { isDistinct } = this.extra ?? {};
    const { dbFieldName } = field;
    const column = this.knex.ref(dbFieldName);

    if (isDistinct) {
      return this.originQueryBuilder.countDistinct(dbFieldName);
    }

    return this.originQueryBuilder.select(column).groupBy(dbFieldName);
  }

  date(field: IFieldInstance): Knex.QueryBuilder {
    if (!field) return this.originQueryBuilder;

    const { isDistinct } = this.extra ?? {};
    const { dbFieldName, options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;

    if (time !== TimeFormatting.None) {
      const column = this.knex.ref(dbFieldName);
      return isDistinct
        ? this.originQueryBuilder.countDistinct(dbFieldName)
        : this.originQueryBuilder.select(column).groupBy(dbFieldName);
    }

    const format = date;
    const column = this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), '${format}') as ??`, [
      timeZone,
      dbFieldName,
      dbFieldName,
    ]);

    if (isDistinct) {
      return this.originQueryBuilder.countDistinct(
        this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), '${format}')`, [timeZone, dbFieldName])
      );
    }

    return this.originQueryBuilder
      .select(column)
      .groupBy(this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), '${format}')`, [timeZone, dbFieldName]));
  }

  json(field: IFieldInstance): Knex.QueryBuilder {
    if (!field) return this.originQueryBuilder;

    const { isDistinct } = this.extra ?? {};
    const { dbFieldName } = field;
    const column = this.knex.raw(`CAST(?? as text)`, [dbFieldName]);

    if (isDistinct) {
      return this.originQueryBuilder.countDistinct(dbFieldName);
    }

    return this.originQueryBuilder.select(column).groupBy(dbFieldName);
  }
}
