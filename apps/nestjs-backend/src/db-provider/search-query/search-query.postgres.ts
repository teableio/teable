import type { IDateFieldOptions, INumberFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';

export class SearchQueryPostgres extends SearchQueryAbstract {
  constructor(originQueryBuilder: Knex.QueryBuilder, field: IFieldInstance, searchValue: string) {
    super(originQueryBuilder, field, searchValue);
  }

  multipleNumber() {
    const precision = (this.field.options as INumberFieldOptions).formatting.precision;
    return this.originQueryBuilder.whereRaw(
      `
      EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(??::jsonb) as elem
        WHERE ROUND(elem::numeric, ?) ILIKE ?
      )
    `,
      [this.field.dbFieldName, precision, `%${this.searchValue}%`]
    );
  }

  multipleDate() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.whereRaw(
      `
      EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(??::jsonb) as elem
        WHERE TO_CHAR(TIMEZONE(?, elem::timestamp), 'YYYY-MM-DD HH24:MI:SS') ILIKE ?
      )
    `,
      [this.field.dbFieldName, timeZone, `%${this.searchValue}%`]
    );
  }

  multipleText() {
    return this.originQueryBuilder.whereRaw(
      `
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(??::jsonb) as elem
        WHERE elem ~* ?
      )
    `,
      [this.field.dbFieldName, this.searchValue]
    );
  }

  multipleJson() {
    return this.originQueryBuilder.whereRaw(
      `
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(??::jsonb) as elem
        WHERE elem->>'title' ~* ?
      )
    `,
      [this.field.dbFieldName, this.searchValue]
    );
  }

  json() {
    return this.originQueryBuilder.whereRaw("??->>'title' ILIKE ?", [
      this.field.dbFieldName,
      `%${this.searchValue}%`,
    ]);
  }

  text() {
    return this.originQueryBuilder.where(this.field.dbFieldName, 'ILIKE', `%${this.searchValue}%`);
  }

  date() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.whereRaw(
      "TO_CHAR(TIMEZONE(?, ??), 'YYYY-MM-DD HH24:MI:SS') ILIKE ?",
      [timeZone, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  number() {
    const precision = (this.field.options as INumberFieldOptions).formatting.precision;
    return this.originQueryBuilder.whereRaw('ROUND(??::numeric, ?)::text ILIKE ?', [
      this.field.dbFieldName,
      precision,
      `%${this.searchValue}%`,
    ]);
  }
}
