import type { INumberFieldOptions, IDateFieldOptions, DateFormattingPreset } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import { isUserOrLink } from '../../utils/is-user-or-link';
import { getPostgresDateTimeFormatString } from './format-string';
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
    const columnName = this.getTableColumnName(field);
    const column = this.knex.ref(columnName);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(columnName);
    }
    return this.originQueryBuilder.select(column).groupBy(columnName);
  }

  number(field: IFieldInstance): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { precision = 0 } = (options as INumberFieldOptions).formatting ?? {};
    const column = this.knex.raw('ROUND(??::numeric, ?)::float as ??', [
      columnName,
      precision,
      columnName,
    ]);
    const groupByColumn = this.knex.raw('ROUND(??::numeric, ?)::float', [columnName, precision]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  date(field: IFieldInstance): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    const column = this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), ?) as ??`, [
      timeZone,
      columnName,
      formatString,
      columnName,
    ]);
    const groupByColumn = this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), ?)`, [
      timeZone,
      columnName,
      formatString,
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
          const column = this.knex.raw(`??::jsonb ->> 'id'`, [columnName]);

          return this.originQueryBuilder.countDistinct(column);
        }

        const column = this.knex.raw(`jsonb_path_query_array(??::jsonb, '$[*].id')::text`, [
          columnName,
        ]);

        return this.originQueryBuilder.countDistinct(column);
      }
      return this.originQueryBuilder.countDistinct(columnName);
    }

    if (isUserOrLink(type)) {
      if (!isMultipleCellValue) {
        const column = this.knex.raw(
          `NULLIF(jsonb_build_object(
            'id', ??::jsonb ->> 'id',
            'title', ??::jsonb ->> 'title'
          ), '{"id":null,"title":null}') as ??`,
          [columnName, columnName, columnName]
        );
        const groupByColumn = this.knex.raw(`??::jsonb ->> 'id', ??::jsonb ->> 'title'`, [
          columnName,
          columnName,
        ]);

        return this.originQueryBuilder.select(column).groupBy(groupByColumn);
      }

      const column = this.knex.raw(`(jsonb_agg(??::jsonb) -> 0) as ??`, [columnName, columnName]);
      const groupByColumn = this.knex.raw(
        `jsonb_path_query_array(??::jsonb, '$[*].id')::text, jsonb_path_query_array(??::jsonb, '$[*].title')::text`,
        [columnName, columnName]
      );

      return this.originQueryBuilder.select(column).groupBy(groupByColumn);
    }

    const column = this.knex.raw(`CAST(?? as text)`, [columnName]);
    return this.originQueryBuilder.select(column).groupBy(columnName);
  }

  multipleDate(field: IFieldInstance): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    const column = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
      FROM jsonb_array_elements_text(??::jsonb) as elem) as ??
      `,
      [timeZone, formatString, columnName, columnName]
    );
    const groupByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      `,
      [timeZone, formatString, columnName]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  multipleNumber(field: IFieldInstance): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { precision = 0 } = (options as INumberFieldOptions).formatting ?? {};
    const column = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
      FROM jsonb_array_elements_text(??::jsonb) as elem) as ??
      `,
      [precision, columnName, columnName]
    );
    const groupByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?)))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      `,
      [precision, columnName]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }
}
