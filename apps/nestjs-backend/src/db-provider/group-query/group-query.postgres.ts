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
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    const column = this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), ?) as ??`, [
      timeZone,
      dbFieldName,
      formatString,
      dbFieldName,
    ]);
    const groupByColumn = this.knex.raw(`TO_CHAR(TIMEZONE(?, ??), ?)`, [
      timeZone,
      dbFieldName,
      formatString,
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
          const column = this.knex.raw(`??::jsonb ->> 'id'`, [dbFieldName]);

          return this.originQueryBuilder.countDistinct(column);
        }

        const column = this.knex.raw(`jsonb_path_query_array(??::jsonb, '$[*].id')::text`, [
          dbFieldName,
        ]);

        return this.originQueryBuilder.countDistinct(column);
      }
      return this.originQueryBuilder.countDistinct(dbFieldName);
    }

    if (isUserOrLink(type)) {
      if (!isMultipleCellValue) {
        const column = this.knex.raw(
          `NULLIF(jsonb_build_object(
            'id', ??::jsonb ->> 'id',
            'title', ??::jsonb ->> 'title'
          ), '{"id":null,"title":null}') as ??`,
          [dbFieldName, dbFieldName, dbFieldName]
        );
        const groupByColumn = this.knex.raw(`??::jsonb ->> 'id', ??::jsonb ->> 'title'`, [
          dbFieldName,
          dbFieldName,
        ]);

        return this.originQueryBuilder.select(column).groupBy(groupByColumn);
      }

      const column = this.knex.raw(`(jsonb_agg(??::jsonb) -> 0) as ??`, [dbFieldName, dbFieldName]);
      const groupByColumn = this.knex.raw(
        `jsonb_path_query_array(??::jsonb, '$[*].id')::text, jsonb_path_query_array(??::jsonb, '$[*].title')::text`,
        [dbFieldName, dbFieldName]
      );

      return this.originQueryBuilder.select(column).groupBy(groupByColumn);
    }

    const column = this.knex.raw(`CAST(?? as text)`, [dbFieldName]);
    return this.originQueryBuilder.select(column).groupBy(dbFieldName);
  }

  multipleDate(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldName, options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const formatString = getPostgresDateTimeFormatString(date as DateFormattingPreset, time);

    const column = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
      FROM jsonb_array_elements_text(??::jsonb) as elem) as ??
      `,
      [timeZone, formatString, dbFieldName, dbFieldName]
    );
    const groupByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), ?)))
      FROM jsonb_array_elements_text(??::jsonb) as elem)
      `,
      [timeZone, formatString, dbFieldName]
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
