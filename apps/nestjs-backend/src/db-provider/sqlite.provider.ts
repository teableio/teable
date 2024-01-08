/* eslint-disable sonarjs/no-duplicate-string */
import { Logger } from '@nestjs/common';
import type { IAggregationField, IFilter, ISort } from '@teable-group/core';
import { DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { SchemaType } from '../features/field/util';
import type { IAggregationQueryInterface } from './aggregation-query/aggregation-query.interface';
import { AggregationQuerySqlite } from './aggregation-query/sqlite/aggregation-query.sqlite';
import type {
  IAggregationQueryExtra,
  IDbProvider,
  IFilterQueryExtra,
  ISortQueryExtra,
} from './db.provider.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQuerySqlite } from './filter-query/sqlite/filter-query.sqlite';
import type { ISortQueryInterface } from './sort-query/sort-query.interface';
import { SortQuerySqlite } from './sort-query/sort-query.sqlite';

export class SqliteProvider implements IDbProvider {
  private readonly logger = new Logger(SqliteProvider.name);

  constructor(private readonly knex: Knex) {}

  driver = DriverClient.Sqlite;

  createSchema(_schemaName: string) {
    return undefined;
  }

  generateDbTableName(baseId: string, name: string) {
    return `${baseId}_${name}`;
  }

  renameTableName(oldTableName: string, newTableName: string) {
    return [this.knex.raw('ALTER TABLE ?? RENAME TO ??', [oldTableName, newTableName]).toQuery()];
  }

  renameColumnName(tableName: string, oldName: string, newName: string): string[] {
    return [
      this.knex
        .raw('ALTER TABLE ?? RENAME COLUMN ?? TO ??', [tableName, oldName, newName])
        .toQuery(),
    ];
  }

  modifyColumnSchema(tableName: string, columnName: string, schemaType: SchemaType): string[] {
    return [
      this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [tableName, columnName]).toQuery(),
      this.knex
        .raw(`ALTER TABLE ?? ADD COLUMN ?? ??`, [tableName, columnName, schemaType])
        .toQuery(),
    ];
  }

  dropColumn(tableName: string, columnName: string): string[] {
    return [this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [tableName, columnName]).toQuery()];
  }

  dropColumnAndIndex(tableName: string, columnName: string, indexName: string): string[] {
    return [
      this.knex.raw(`DROP INDEX IF EXISTS ??`, [indexName]).toQuery(),
      this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [tableName, columnName]).toQuery(),
    ];
  }

  columnInfo(tableName: string, _columnName: string): string {
    return this.knex.raw(`PRAGMA table_info(??)`, [tableName]).toQuery();
  }

  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string {
    // TODO: The code doesn't taste good because knex utilizes the "select-stmt" mode to construct SQL queries for SQLite batchInsert.
    //  This is a temporary solution, and I'm actively keeping an eye on this issue for further developments.
    const builder = this.knex.client.queryBuilder();
    builder.insert(insertData).into(tableName).toSQL();

    const { _single } = builder;
    const compiler = this.knex.client.queryCompiler(builder);

    const insertValues = _single.insert || [];
    const sql = `insert into ${compiler.tableName} `;
    const body = compiler._insertBody(insertValues);
    const bindings = compiler.bindings;
    return this.knex.raw(sql + body, bindings).toQuery();
  }

  executeUpdateRecordsSqlList(params: {
    dbTableName: string;
    tempTableName: string;
    idFieldName: string;
    dbFieldNames: string[];
    data: { id: string; values: { [key: string]: unknown } }[];
  }) {
    const { dbTableName, tempTableName, idFieldName, dbFieldNames, data } = params;
    const insertRowsData = data.map((item) => {
      return {
        [idFieldName]: item.id,
        ...item.values,
      };
    });

    // initialize temporary table data
    const insertTempTableSql = this.batchInsertSql(tempTableName, insertRowsData);

    // update data
    const updateColumns = dbFieldNames.reduce<{ [key: string]: unknown }>((pre, columnName) => {
      pre[columnName] = this.knex.ref(`${tempTableName}.${columnName}`);
      return pre;
    }, {});
    let updateRecordSql = this.knex(dbTableName).update(updateColumns).toQuery();
    updateRecordSql += ` FROM \`${tempTableName}\` WHERE ${dbTableName}.${idFieldName} = ${tempTableName}.${idFieldName}`;

    return { insertTempTableSql, updateRecordSql };
  }

  aggregationQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    fields?: { [fieldId: string]: IFieldInstance },
    aggregationFields?: IAggregationField[],
    extra?: IAggregationQueryExtra
  ): IAggregationQueryInterface {
    return new AggregationQuerySqlite(
      this.knex,
      originQueryBuilder,
      dbTableName,
      fields,
      aggregationFields,
      extra
    );
  }

  filterQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [p: string]: IFieldInstance },
    filter?: IFilter,
    extra?: IFilterQueryExtra
  ): IFilterQueryInterface {
    return new FilterQuerySqlite(originQueryBuilder, fields, filter, extra);
  }

  sortQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: IFieldInstance },
    sortObjs?: ISort['sortObjs'],
    extra?: ISortQueryExtra
  ): ISortQueryInterface {
    return new SortQuerySqlite(this.knex, originQueryBuilder, fields, sortObjs, extra);
  }
}
