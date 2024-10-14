import type { DateFormattingPreset, INumberFieldOptions, IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import { isUserOrLink } from '../../utils/is-user-or-link';
import { getOffset } from '../search-query/get-offset';
import { getSqliteDateTimeFormatString } from './format-string';
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
    const { dbFieldName, options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetStr = `${getOffset(timeZone)} hour`;
    const column = this.knex.raw('strftime(?, DATETIME(??, ?)) as ??', [
      formatString,
      dbFieldName,
      offsetStr,
      dbFieldName,
    ]);
    const groupByColumn = this.knex.raw('strftime(?, DATETIME(??, ?))', [
      formatString,
      dbFieldName,
      offsetStr,
    ]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  json(field: IFieldInstance): Knex.QueryBuilder {
    const { type, dbFieldName, isMultipleCellValue } = field;

    if (this.isDistinct) {
      if (isUserOrLink(type)) {
        if (!isMultipleCellValue) {
          const groupByColumn = this.knex.raw(
            `json_extract(??, '$.id') || json_extract(??, '$.title')`,
            [dbFieldName, dbFieldName]
          );
          return this.originQueryBuilder.countDistinct(groupByColumn);
        }
        const groupByColumn = this.knex.raw(`json_extract(??, '$[0].id', '$[0].title')`, [
          dbFieldName,
        ]);
        return this.originQueryBuilder.countDistinct(groupByColumn);
      }
      return this.originQueryBuilder.countDistinct(dbFieldName);
    }

    if (isUserOrLink(type)) {
      if (!isMultipleCellValue) {
        const groupByColumn = this.knex.raw(
          `json_extract(??, '$.id') || json_extract(??, '$.title')`,
          [dbFieldName, dbFieldName]
        );
        return this.originQueryBuilder.select(dbFieldName).groupBy(groupByColumn);
      }

      const groupByColumn = this.knex.raw(`json_extract(??, '$[0].id', '$[0].title')`, [
        dbFieldName,
      ]);
      return this.originQueryBuilder.select(dbFieldName).groupBy(groupByColumn);
    }

    const column = this.knex.raw(`CAST(?? as text) as ??`, [dbFieldName, dbFieldName]);
    return this.originQueryBuilder.select(column).groupBy(dbFieldName);
  }

  multipleDate(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);

    const offsetStr = `${getOffset(timeZone)} hour`;
    const column = this.knex.raw(
      `
      (
        SELECT json_group_array(strftime(?, DATETIME(value, ?)))
        FROM json_each(??)
      ) as ??
      `,
      [formatString, offsetStr, dbFieldName, dbFieldName]
    );
    const groupByColumn = this.knex.raw(
      `
      (
        SELECT json_group_array(strftime(?, DATETIME(value, ?)))
        FROM json_each(??)
      )
      `,
      [formatString, offsetStr, dbFieldName]
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
