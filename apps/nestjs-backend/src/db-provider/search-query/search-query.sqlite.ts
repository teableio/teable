import type { IDateFieldOptions, INumberFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';
import { getOffset } from './get-offset';

export class SearchQuerySqlite extends SearchQueryAbstract {
  constructor(originQueryBuilder: Knex.QueryBuilder, field: IFieldInstance, searchValue: string) {
    super(originQueryBuilder, field, searchValue);
  }

  multipleNumber() {
    const precision = (this.field.options as INumberFieldOptions).formatting.precision;
    return this.originQueryBuilder.whereRaw(
      `
      EXISTS (
        SELECT 1 FROM json_each(??) as je
        WHERE ROUND(je.value, ?) LIKE ?
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
        SELECT 1 FROM json_each(??) as je
        WHERE DATETIME(je.value, ?) LIKE ?
      )
    `,
      [this.field.dbFieldName, `${getOffset(timeZone)} hour`, `%${this.searchValue}%`]
    );
  }

  multipleText() {
    return this.originQueryBuilder.whereRaw(
      `
      EXISTS (
        SELECT 1 FROM json_each(??) as je
        WHERE je.value LIKE ? AND je.key != 'title'
      )
    `,
      [this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  multipleJson() {
    return this.originQueryBuilder.whereRaw(
      `
      EXISTS (
        SELECT 1 FROM json_each(??) as je
        WHERE json_extract(je.value, '$.title') LIKE ?
      )
    `,
      [this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  json() {
    return this.originQueryBuilder.whereRaw("json_extract(??, '$.title') LIKE ?", [
      this.field.dbFieldName,
      `%${this.searchValue}%`,
    ]);
  }

  text() {
    return this.originQueryBuilder.where(this.field.dbFieldName, 'LIKE', `%${this.searchValue}%`);
  }

  date() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.whereRaw('DATETIME(??, ?) LIKE ?', [
      this.field.dbFieldName,
      `${getOffset(timeZone)} hour`,
      `%${this.searchValue}%`,
    ]);
  }

  number() {
    const precision = (this.field.options as INumberFieldOptions).formatting.precision;
    return this.originQueryBuilder.whereRaw('ROUND(??, ?) LIKE ?', [
      this.field.dbFieldName,
      precision,
      `%${this.searchValue}%`,
    ]);
  }
}
