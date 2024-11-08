import type { IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';

export class SearchQueryPostgres extends SearchQueryAbstract {
  constructor(originQueryBuilder: Knex.QueryBuilder, field: IFieldInstance, searchValue: string) {
    super(originQueryBuilder, field, searchValue);
  }

  multipleNumber() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(ROUND(elem::numeric, ?)::text, ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
      [precision, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  multipleDate() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), 'YYYY-MM-DD HH24:MI'), ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
      [timeZone, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  multipleText() {
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1
        FROM (
          SELECT string_agg(elem::text, ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
    `,
      [this.field.dbFieldName, this.searchValue]
    );
  }

  multipleJson() {
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(elem->>'title', ', ') as aggregated
          FROM jsonb_array_elements(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
      `,
      [this.field.dbFieldName, this.searchValue]
    );
  }

  json() {
    return this.originQueryBuilder.orWhereRaw("??->>'title' ILIKE ?", [
      this.field.dbFieldName,
      `%${this.searchValue}%`,
    ]);
  }

  text() {
    return this.originQueryBuilder.orWhere(
      this.field.dbFieldName,
      'ILIKE',
      `%${this.searchValue}%`
    );
  }

  date() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.orWhereRaw(
      "TO_CHAR(TIMEZONE(?, ??), 'YYYY-MM-DD HH24:MI') ILIKE ?",
      [timeZone, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  number() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw('ROUND(??::numeric, ?)::text ILIKE ?', [
      this.field.dbFieldName,
      precision,
      `%${this.searchValue}%`,
    ]);
  }

  getNumberSqlQuery() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw('ROUND(??::numeric, ?)::text ILIKE ?', [
        this.field.dbFieldName,
        precision,
        `%${this.searchValue}%`,
      ])
      .toQuery();
  }

  getDateSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knexInstance
      .raw("TO_CHAR(TIMEZONE(?, ??), 'YYYY-MM-DD HH24:MI') ILIKE ?", [
        timeZone,
        this.field.dbFieldName,
        `%${this.searchValue}%`,
      ])
      .toQuery();
  }

  getTextSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw('?? ILIKE ?', [this.field.dbFieldName, `%${this.searchValue}%`])
      .toQuery();
  }

  getJsonSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw("??->>'title' ILIKE ?", [this.field.dbFieldName, `%${this.searchValue}%`])
      .toQuery();
  }

  getMultipleDateSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return knexInstance
      .raw(
        `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(TO_CHAR(TIMEZONE(?, CAST(elem AS timestamp with time zone)), 'YYYY-MM-DD HH24:MI'), ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
        [timeZone, this.field.dbFieldName, `%${this.searchValue}%`]
      )
      .toQuery();
  }

  getMultipleTextSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw(
        `
      EXISTS (
        SELECT 1
        FROM (
          SELECT string_agg(elem::text, ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
    `,
        [this.field.dbFieldName, this.searchValue]
      )
      .toQuery();
  }

  getMultipleNumberSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knexInstance
      .raw(
        `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(ROUND(elem::numeric, ?)::text, ', ') as aggregated
          FROM jsonb_array_elements_text(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ILIKE ?
      )
      `,
        [precision, this.field.dbFieldName, `%${this.searchValue}%`]
      )
      .toQuery();
  }

  getMultipleJsonSqlQuery() {
    const knexInstance = this.originQueryBuilder.client;
    return knexInstance
      .raw(
        `
      EXISTS (
        SELECT 1 FROM (
          SELECT string_agg(elem->>'title', ', ') as aggregated
          FROM jsonb_array_elements(??::jsonb) as elem
        ) as sub
        WHERE sub.aggregated ~* ?
      )
      `,
        [this.field.dbFieldName, this.searchValue]
      )
      .toQuery();
  }
}
