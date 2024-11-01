import type { IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import { SearchQueryAbstract } from './abstract';
import { getOffset } from './get-offset';

export class SearchQuerySqlite extends SearchQueryAbstract {
  constructor(originQueryBuilder: Knex.QueryBuilder, field: IFieldInstance, searchValue: string) {
    super(originQueryBuilder, field, searchValue);
  }

  multipleNumber() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(ROUND(je.value, ?), ', ') as aggregated
          FROM json_each(??) as je
        )
        WHERE aggregated LIKE ?
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
          SELECT group_concat(DATETIME(je.value, ?), ', ') as aggregated
          FROM json_each(??) as je
        )
        WHERE aggregated LIKE ?
      )
      `,
      [`${getOffset(timeZone)} hour`, this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  multipleText() {
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(je.value, ', ') as aggregated
          FROM json_each(??) as je
          WHERE je.key != 'title'
        )
        WHERE aggregated LIKE ?
      )
      `,
      [this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  multipleJson() {
    return this.originQueryBuilder.orWhereRaw(
      `
      EXISTS (
        SELECT 1 FROM (
          SELECT group_concat(json_extract(je.value, '$.title'), ', ') as aggregated
          FROM json_each(??) as je
        )
        WHERE aggregated LIKE ?
      )
      `,
      [this.field.dbFieldName, `%${this.searchValue}%`]
    );
  }

  json() {
    return this.originQueryBuilder.orWhereRaw("json_extract(??, '$.title') LIKE ?", [
      this.field.dbFieldName,
      `%${this.searchValue}%`,
    ]);
  }

  text() {
    return this.originQueryBuilder.orWhere(this.field.dbFieldName, 'LIKE', `%${this.searchValue}%`);
  }

  date() {
    const timeZone = (this.field.options as IDateFieldOptions).formatting.timeZone;
    return this.originQueryBuilder.orWhereRaw('DATETIME(??, ?) LIKE ?', [
      this.field.dbFieldName,
      `${getOffset(timeZone)} hour`,
      `%${this.searchValue}%`,
    ]);
  }

  number() {
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return this.originQueryBuilder.orWhereRaw('ROUND(??, ?) LIKE ?', [
      this.field.dbFieldName,
      precision,
      `%${this.searchValue}%`,
    ]);
  }
}
