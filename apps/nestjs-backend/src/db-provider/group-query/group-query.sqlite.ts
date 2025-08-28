import type { DateFormattingPreset, INumberFieldOptions, IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IRecordQueryGroupContext } from '../../features/record/query-builder/record-query-builder.interface';
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
    protected readonly extra?: IGroupQueryExtra,
    protected readonly context?: IRecordQueryGroupContext
  ) {
    super(knex, originQueryBuilder, fieldMap, groupFieldIds, extra, context);
  }

  private get isDistinct() {
    const { isDistinct } = this.extra ?? {};
    return isDistinct;
  }

  string(field: IFieldInstance): Knex.QueryBuilder {
    if (!field) return this.originQueryBuilder;

    const columnName = this.getTableColumnName(field);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(columnName);
    }
    return this.originQueryBuilder
      .select({ [field.dbFieldName]: this.knex.raw(columnName) })
      .groupByRaw(columnName);
  }

  number(field: IFieldInstance): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const column = this.knex.raw(`ROUND(${columnName}, ?) as ${columnName}`, [precision]);
    const groupByColumn = this.knex.raw(`ROUND(${columnName}, ?)`, [precision]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  date(field: IFieldInstance): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);
    const offsetStr = `${getOffset(timeZone)} hour`;
    const column = this.knex.raw(`strftime(?, DATETIME(${columnName}, ?)) as ${columnName}`, [
      formatString,
      offsetStr,
    ]);
    const groupByColumn = this.knex.raw(`strftime(?, DATETIME(${columnName}, ?))`, [
      formatString,
      offsetStr,
    ]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  json(field: IFieldInstance): Knex.QueryBuilder {
    const { type, isMultipleCellValue } = field;
    const columnName = this.getTableColumnName(field);

    if (this.isDistinct) {
      if (isUserOrLink(type)) {
        if (!isMultipleCellValue) {
          const groupByColumn = this.knex.raw(
            `json_extract(${columnName}, '$.id') || json_extract(${columnName}, '$.title')`
          );
          return this.originQueryBuilder.countDistinct(groupByColumn);
        }
        const groupByColumn = this.knex.raw(`json_extract(${columnName}, '$[0].id', '$[0].title')`);
        return this.originQueryBuilder.countDistinct(groupByColumn);
      }
      return this.originQueryBuilder.countDistinct(columnName);
    }

    if (isUserOrLink(type)) {
      if (!isMultipleCellValue) {
        const groupByColumn = this.knex.raw(
          `json_extract(${columnName}, '$.id') || json_extract(${columnName}, '$.title')`
        );
        return this.originQueryBuilder.select(columnName).groupBy(groupByColumn);
      }

      const groupByColumn = this.knex.raw(`json_extract(${columnName}, '$[0].id', '$[0].title')`);
      return this.originQueryBuilder.select(columnName).groupBy(groupByColumn);
    }

    const column = this.knex.raw(`CAST(${columnName} as text) as ${columnName}`);
    return this.originQueryBuilder.select(column).groupByRaw(columnName);
  }

  multipleDate(field: IFieldInstance): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getSqliteDateTimeFormatString(date as DateFormattingPreset, time);

    const offsetStr = `${getOffset(timeZone)} hour`;
    const column = this.knex.raw(
      `
      (
        SELECT json_group_array(strftime(?, DATETIME(value, ?)))
        FROM json_each(${columnName})
      ) as ${columnName}
      `,
      [formatString, offsetStr]
    );
    const groupByColumn = this.knex.raw(
      `
      (
        SELECT json_group_array(strftime(?, DATETIME(value, ?)))
        FROM json_each(${columnName})
      )
      `,
      [formatString, offsetStr]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  multipleNumber(field: IFieldInstance): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { precision } = (options as INumberFieldOptions).formatting;
    const column = this.knex.raw(
      `
      (
        SELECT json_group_array(ROUND(value, ?))
        FROM json_each(${columnName})
      ) as ${columnName}
      `,
      [precision]
    );
    const groupByColumn = this.knex.raw(
      `
      (
        SELECT json_group_array(ROUND(value, ?))
        FROM json_each(${columnName})
      )
      `,
      [precision]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }
}
