import { CellValueType, type IDateFieldOptions } from '@teable/core';
import type { Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { ISearchCellValueType } from './types';

export class VectorTransform {
  constructor(
    public field: IFieldInstance,
    public knex: Knex.Client,
    public dbTableName: string
  ) {
    this.field = field;
    this.knex = knex;
    this.dbTableName = dbTableName;
  }

  getRawSql() {
    const { isMultipleCellValue } = this.field;
    return isMultipleCellValue ? this.getMultipleRawSql() : this.getSingleRawSql();
  }

  getSingleRawSql() {
    const { field } = this;
    const { isStructuredCellValue, cellValueType } = field;
    switch (cellValueType as ISearchCellValueType) {
      case CellValueType.String: {
        if (isStructuredCellValue) {
          return this.json();
        } else {
          return this.text();
        }
      }
      case CellValueType.DateTime: {
        return this.date();
      }
      case CellValueType.Number: {
        return this.number();
      }
      default:
        return this.text();
    }
  }

  getMultipleRawSql() {
    const { field } = this;
    const { isStructuredCellValue, cellValueType } = field;
    switch (cellValueType as ISearchCellValueType) {
      case CellValueType.String: {
        if (isStructuredCellValue) {
          return this.multipleJson();
        } else {
          return this.multipleText();
        }
      }
      case CellValueType.DateTime: {
        return this.multipleDate();
      }
      case CellValueType.Number: {
        return this.multipleNumber();
      }
      default:
        return this.multipleText();
    }
  }

  text() {
    const {
      knex,
      field: { dbFieldName },
    } = this;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    return knex
      .raw(`?? = to_tsvector('simple', COALESCE(??, ''))`, [tsColumnName, dbFieldName])
      .toQuery();
  }

  number() {
    const {
      knex,
      field: { dbFieldName },
    } = this;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex
      .raw(`?? = to_tsvector('simple', COALESCE(ROUND(??::numeric, ${precision})::text, ''))`, [
        tsColumnName,
        dbFieldName,
      ])
      .toQuery();
  }

  date() {
    const {
      knex,
      field: { dbFieldName, options },
    } = this;
    const timeZone = (options as IDateFieldOptions).formatting.timeZone;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    // "TO_CHAR(TIMEZONE(?, ??), 'YYYY-MM-DD HH24:MI')

    return knex
      .raw(
        `?? = to_tsvector('simple', 
          to_char((??)::timestamp AT TIME ZONE ?, 'YYYY-MM-DD HH24:MI:SS')
        )`,
        [tsColumnName, dbFieldName, timeZone]
      )
      .toQuery();
  }

  json() {
    const {
      knex,
      field: { dbFieldName },
    } = this;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    return knex
      .raw(`?? = to_tsvector('simple', COALESCE(??->>'title', ''))`, [tsColumnName, dbFieldName])
      .toQuery();
  }

  multipleText() {
    const {
      knex,
      field: { dbFieldName },
    } = this;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    return knex
      .raw(
        `?? = to_tsvector('simple',
          COALESCE(
            (
              SELECT string_agg(elem::text, ' ')
              FROM jsonb_array_elements_text(??::jsonb) as elem
            ),
            ''
          )
        )`,
        [tsColumnName, dbFieldName]
      )
      .toQuery();
  }

  multipleNumber() {
    const {
      knex,
      field: { dbFieldName },
    } = this;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    const precision = get(this.field, ['options', 'formatting', 'precision']) ?? 0;
    return knex
      .raw(
        `?? = to_tsvector('simple',
          COALESCE(
            (
              SELECT string_agg(ROUND(elem::numeric, ?)::text, ' ')
              FROM jsonb_array_elements_text(??::jsonb) as elem
            ),
            ''
          )
        )`,
        [tsColumnName, precision, dbFieldName]
      )
      .toQuery();
  }

  multipleDate() {
    const {
      knex,
      field: { dbFieldName, options },
    } = this;
    const timeZone = (options as IDateFieldOptions).formatting.timeZone;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);

    return knex
      .raw(
        `?? = to_tsvector('simple',
          COALESCE(
            (
              SELECT string_agg(
                to_char((elem::timestamp AT TIME ZONE ?), 'YYYY-MM-DD HH24:MI:SS'),
                ' '
              )
              FROM jsonb_array_elements_text(??::jsonb) as elem
            ),
            ''
          )
        )`,
        [tsColumnName, timeZone, dbFieldName]
      )
      .toQuery();
  }

  multipleJson() {
    const {
      knex,
      field: { dbFieldName },
    } = this;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    return knex
      .raw(
        `?? = to_tsvector('simple',
          COALESCE(
            (
              SELECT string_agg(elem->>'title', ' ')
              FROM jsonb_array_elements(??::jsonb) as elem
            ),
            ''
          )
        )`,
        [tsColumnName, dbFieldName]
      )
      .toQuery();
  }
}

export class FullTextSearchQueryPostgresBuilder {
  constructor(
    public queryBuilder: Knex.QueryBuilder,
    public dbTableName: string,
    public searchFields: IFieldInstance[]
  ) {
    this.queryBuilder = queryBuilder;
    this.dbTableName = dbTableName;
    this.searchFields = searchFields;
  }

  static getTsVectorColumnName(dbFieldName: string) {
    return `${dbFieldName}_ts_vector`;
  }

  static getGinIndexName(dbFieldName: string, dbTableName: string) {
    const tableName = dbTableName.split('.').pop();
    return `${tableName}___${dbFieldName}_gin_idx`;
  }

  static getExistFtsIndexSql(queryBuilder: Knex.QueryBuilder, dbTableName: string) {
    const knexInstance = queryBuilder.client;
    const tableName = dbTableName.split('.').pop();
    return knexInstance
      .raw(
        `
      SELECT EXISTS (SELECT 1
               FROM information_schema.columns
               WHERE table_name = ?
                 AND data_type = 'tsvector')
      `,
        tableName
      )
      .toQuery();
  }

  getPgTrgmExtensionEnableSql() {
    const { queryBuilder } = this;
    const knexInstance = queryBuilder.client;
    return knexInstance.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm').toQuery();
  }

  getCreateTsVectorSql(dbFieldName: string) {
    const { queryBuilder } = this;
    const knex = queryBuilder.client;
    const columnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    return knex.raw(`ADD COLUMN ?? tsvector`, [columnName]).toQuery();
  }

  getCreateTsVectorsSql(fields: IFieldInstance[]) {
    const { queryBuilder, dbTableName } = this;
    const knex = queryBuilder.client;
    const rawSqls = fields.map(({ dbFieldName }) => {
      return this.getCreateTsVectorSql(dbFieldName);
    });
    return knex.raw(`ALTER TABLE ?? ${rawSqls.join(',')}`, [dbTableName]).toQuery();
  }

  getCreateGinIndexSql(dbFieldName: string) {
    const { queryBuilder, dbTableName } = this;
    const tsColumnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    const ginIndexName = FullTextSearchQueryPostgresBuilder.getGinIndexName(
      dbFieldName,
      dbTableName
    );
    const knex = queryBuilder.client;
    return knex
      .raw(`CREATE INDEX IF NOT EXISTS ${ginIndexName} ON ?? USING gin (??);`, [
        dbTableName,
        tsColumnName,
      ])
      .toQuery();
  }

  getUpdateVectorSql(field: IFieldInstance) {
    const { queryBuilder, dbTableName } = this;
    const knex = queryBuilder.client;
    const transformer = new VectorTransform(field, knex, dbTableName);
    return transformer.getRawSql();
  }

  getUpdateVectorsSql(field: IFieldInstance[]) {
    const { queryBuilder, dbTableName } = this;
    const knex = queryBuilder.client;
    const sqls = field.map((f) => {
      return this.getUpdateVectorSql(f);
    });
    return knex.raw(`UPDATE ?? Set ${sqls.join(',')}`, [dbTableName]).toQuery();
  }

  getCreateTriggerFunctionSql(dbFieldName: string) {
    const { queryBuilder } = this;
    const knex = queryBuilder.client;
    const tsName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    return knex
      .raw(
        `
CREATE OR REPLACE FUNCTION update_${dbFieldName}_tsvector()
    RETURNS trigger AS
$$
BEGIN
    NEW.?? = to_tsvector('simple', NEW.??);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
        [tsName, dbFieldName]
      )
      .toQuery();
  }

  getCreateTriggerSql(dbFieldName: string) {
    const { queryBuilder, dbTableName } = this;
    const knex = queryBuilder.client;
    return knex
      .raw(
        `
CREATE TRIGGER update_${dbFieldName}_tsvector
    BEFORE INSERT OR UPDATE
    ON ??
    FOR EACH ROW
EXECUTE FUNCTION update_${dbFieldName}_tsvector();`,
        [dbTableName]
      )
      .toQuery();
  }

  getSearchFieldIndexSql() {
    const { searchFields } = this;
    const excSqls = [] as string[];
    const extensionSql = this.getPgTrgmExtensionEnableSql();
    excSqls.push(extensionSql);
    excSqls.push(this.getCreateTsVectorsSql(searchFields));
    excSqls.push(this.getUpdateVectorsSql(searchFields));
    // excSqls.push(this.getCreateTriggerSql(dbFieldName));
    // excSqls.push(this.getCreateTriggerFunctionSql(dbFieldName));
    searchFields.forEach((field) => {
      const { dbFieldName } = field;
      excSqls.push(this.getCreateGinIndexSql(dbFieldName));
    });
    return excSqls;
  }

  getDropTsIndexSql(dbFieldName: string) {
    const { queryBuilder, dbTableName } = this;
    const knex = queryBuilder.client;
    const columnName = FullTextSearchQueryPostgresBuilder.getTsVectorColumnName(dbFieldName);
    return knex.raw(`ALTER TABLE ?? DROP COLUMN IF EXISTS ??`, [dbTableName, columnName]).toQuery();
  }

  getDropGinIndexSql(dbFieldName: string) {
    const { queryBuilder, dbTableName } = this;
    const knex = queryBuilder.client;
    const ginIndexName = FullTextSearchQueryPostgresBuilder.getGinIndexName(
      dbFieldName,
      dbTableName
    );
    return knex.raw(`DROP INDEX IF EXISTS ??`, [ginIndexName]).toQuery();
  }

  getDropTriggerSql(dbFieldName: string) {
    const { queryBuilder, dbTableName } = this;
    const knex = queryBuilder.client;
    return knex
      .raw(`DROP TRIGGER IF EXISTS update_${dbFieldName}_tsvector ON ??`, [dbTableName])
      .toQuery();
  }

  getDropTriggerFnSql(dbFieldName: string) {
    const { queryBuilder } = this;
    const knex = queryBuilder.client;
    return knex.raw(`DROP FUNCTION IF EXISTS update_${dbFieldName}_tsvector()`).toQuery();
  }

  getClearSearchTsIndexSql() {
    const { searchFields } = this;
    const excSqls = [] as string[];
    searchFields.forEach(({ dbFieldName }) => {
      excSqls.push(this.getDropTsIndexSql(dbFieldName));
      excSqls.push(this.getDropGinIndexSql(dbFieldName));
      // excSqls.push(this.getDropTriggerSql(dbFieldName));
      // excSqls.push(this.getDropTriggerFnSql(dbFieldName));
    });

    return excSqls;
  }
}
