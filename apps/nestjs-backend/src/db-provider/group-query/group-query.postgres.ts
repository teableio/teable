/* eslint-disable sonarjs/no-duplicate-string */
import type { INumberFieldOptions, IDateFieldOptions, FieldCore } from '@teable/core';
import { DateFormattingPreset, TimeFormatting } from '@teable/core';
import type { Knex } from 'knex';
import type { IRecordQueryGroupContext } from '../../features/record/query-builder/record-query-builder.interface';
import { isUserOrLink } from '../../utils/is-user-or-link';
import { AbstractGroupQuery } from './group-query.abstract';
import type { IGroupQueryExtra } from './group-query.interface';

export class GroupQueryPostgres extends AbstractGroupQuery {
  constructor(
    protected readonly knex: Knex,
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fieldMap?: { [fieldId: string]: FieldCore },
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

  string(field: FieldCore): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(columnName);
    }
    return this.originQueryBuilder
      .select({ [field.dbFieldName]: this.knex.raw(columnName) })
      .groupByRaw(columnName);
  }

  number(field: FieldCore): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { precision = 0 } = (options as INumberFieldOptions).formatting ?? {};
    const column = this.knex.raw(
      `ROUND(${columnName}::numeric, ?::int)::float as "${field.dbFieldName}"`,
      [precision]
    );
    const groupByColumn = this.knex.raw(`ROUND(${columnName}::numeric, ?::int)::float`, [
      precision,
    ]);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  private resolveDateTruncUnit(
    datePreset: DateFormattingPreset,
    time: TimeFormatting
  ): 'year' | 'month' | 'day' | 'minute' {
    switch (datePreset) {
      case DateFormattingPreset.Y:
        return 'year';
      case DateFormattingPreset.M:
      case DateFormattingPreset.YM:
        return 'month';
      default:
        return time !== TimeFormatting.None ? 'minute' : 'day';
    }
  }

  date(field: FieldCore): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const unit = this.resolveDateTruncUnit(date as DateFormattingPreset, time);
    const dbFieldAlias = field.dbFieldName.replace(/"/g, '""');

    // Use timestamptz group keys:
    // 1) Convert to local timestamp via TIMEZONE(tz, timestamptz)
    // 2) DATE_TRUNC in local time
    // 3) Convert back to timestamptz via TIMEZONE(tz, timestamp)
    const groupExpr = `TIMEZONE(?, DATE_TRUNC(?, TIMEZONE(?, ${columnName})))`;
    const bindings = [timeZone, unit, timeZone] as const;

    const column = this.knex.raw(`${groupExpr} as "${dbFieldAlias}"`, bindings);
    const groupByColumn = this.knex.raw(groupExpr, bindings);

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  json(field: FieldCore): Knex.QueryBuilder {
    const { type, isMultipleCellValue } = field;
    const columnName = this.getTableColumnName(field);

    if (this.isDistinct) {
      if (isUserOrLink(type)) {
        if (!isMultipleCellValue) {
          const column = this.knex.raw(`${columnName}::jsonb ->> 'id'`);

          return this.originQueryBuilder.countDistinct(column);
        }

        const column = this.knex.raw(
          `jsonb_path_query_array(${columnName}::jsonb, '$[*].id')::text`
        );

        return this.originQueryBuilder.countDistinct(column);
      }
      return this.originQueryBuilder.countDistinct(columnName);
    }

    if (isUserOrLink(type)) {
      if (!isMultipleCellValue) {
        const column = this.knex.raw(
          `NULLIF(jsonb_build_object(
            'id', ${columnName}::jsonb ->> 'id',
            'title', ${columnName}::jsonb ->> 'title'
          ), '{"id":null,"title":null}') as "${field.dbFieldName}"`
        );
        const groupByColumn = this.knex.raw(
          `${columnName}::jsonb ->> 'id', ${columnName}::jsonb ->> 'title'`
        );

        return this.originQueryBuilder.select(column).groupBy(groupByColumn);
      }

      const column = this.knex.raw(
        `(jsonb_agg(${columnName}::jsonb) -> 0) as "${field.dbFieldName}"`
      );
      const groupByColumn = this.knex.raw(
        `jsonb_path_query_array(${columnName}::jsonb, '$[*].id')::text, jsonb_path_query_array(${columnName}::jsonb, '$[*].title')::text`
      );

      return this.originQueryBuilder.select(column).groupBy(groupByColumn);
    }

    const column = this.knex.raw(`CAST(${columnName} as text)`);
    return this.originQueryBuilder.select(column).groupByRaw(columnName);
  }

  multipleDate(field: FieldCore): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { date, time, timeZone } = (options as IDateFieldOptions).formatting;
    const unit = this.resolveDateTruncUnit(date as DateFormattingPreset, time);
    const dbFieldAlias = field.dbFieldName.replace(/"/g, '""');

    const elemExpr = `TIMEZONE(?, DATE_TRUNC(?, TIMEZONE(?, CAST(elem AS timestamp with time zone))))`;
    const elemBindings = [timeZone, unit, timeZone] as const;

    const column = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(${elemExpr}))
      FROM jsonb_array_elements_text(${columnName}::jsonb) as elem) as "${dbFieldAlias}"
      `,
      elemBindings
    );
    const groupByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(${elemExpr}))
      FROM jsonb_array_elements_text(${columnName}::jsonb) as elem)
      `,
      elemBindings
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }

  multipleNumber(field: FieldCore): Knex.QueryBuilder {
    const columnName = this.getTableColumnName(field);
    const { options } = field;
    const { precision = 0 } = (options as INumberFieldOptions).formatting ?? {};
    const column = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?::int)))
      FROM jsonb_array_elements_text(${columnName}::jsonb) as elem) as "${field.dbFieldName}"
      `,
      [precision]
    );
    const groupByColumn = this.knex.raw(
      `
      (SELECT to_jsonb(array_agg(ROUND(elem::numeric, ?::int)))
      FROM jsonb_array_elements_text(${columnName}::jsonb) as elem)
      `,
      [precision]
    );

    if (this.isDistinct) {
      return this.originQueryBuilder.countDistinct(groupByColumn);
    }
    return this.originQueryBuilder.select(column).groupBy(groupByColumn);
  }
}
