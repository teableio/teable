import { Logger } from '@nestjs/common';
import type { IFilter } from '@teable-group/core';
import { DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { SchemaType } from '../features/field/util';
import type { IAggregationFunctionInterface } from './aggregation/aggregation-function.interface';
import { AggregationFunctionPostgres } from './aggregation/aggregation-function.postgres';
import type { IDbProvider } from './db.provider.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQueryPostgres } from './filter-query/postgres/filter-query.postgres';

export class PostgresProvider implements IDbProvider {
  private readonly logger = new Logger(PostgresProvider.name);
  constructor(private readonly knex: Knex) {}

  driver = DriverClient.Pg;

  createSchema(schemaName: string) {
    return [
      this.knex.raw(`create schema if not exists ??`, [schemaName]).toQuery(),
      this.knex.raw(`revoke all on schema ?? from public`, [schemaName]).toQuery(),
    ];
  }

  generateDbTableName(baseId: string, name: string) {
    return `${baseId}.${name}`;
  }

  renameTableName(oldTableName: string, newTableName: string) {
    return [this.knex.raw('ALTER TABLE ?? RENAME TO ??', [oldTableName, newTableName]).toQuery()];
  }

  renameColumnName(tableName: string, oldName: string, newName: string): string[] {
    return this.knex.schema
      .alterTable(tableName, (table) => {
        table.renameColumn(oldName, newName);
      })
      .toSQL()
      .map((item) => item.sql);
  }

  dropColumn(tableName: string, columnName: string): string[] {
    return this.knex.schema
      .alterTable(tableName, (table) => {
        table.dropColumn(columnName);
      })
      .toSQL()
      .map((item) => item.sql);
  }

  // postgres drop index with column automatically
  dropColumnAndIndex(tableName: string, columnName: string, _indexName: string): string[] {
    return this.dropColumn(tableName, columnName);
  }

  columnInfo(tableName: string, columnName: string): string {
    const [schemaName, dbTableName] = tableName.split('.');
    return this.knex
      .select({
        name: 'column_name',
      })
      .from('information_schema.columns')
      .where({
        table_schema: schemaName,
        table_name: dbTableName,
        column_name: columnName,
      })
      .toQuery();
  }

  modifyColumnSchema(tableName: string, columnName: string, schemaType: SchemaType): string[] {
    return [this.knex(tableName).update(columnName, null).toQuery()].concat(
      this.knex.schema
        .alterTable(tableName, (table) => {
          table[schemaType](columnName).alter();
        })
        .toSQL()
        .map((item) => item.sql)
    );
  }

  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string {
    return this.knex.insert(insertData).into(tableName).toQuery();
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
    const insertTempTableSql = this.knex.insert(insertRowsData).into(tempTableName).toQuery();

    // update data
    const updateColumns = dbFieldNames.reduce<{ [key: string]: unknown }>((pre, columnName) => {
      pre[columnName] = this.knex.ref(`${tempTableName}.${columnName}`);
      return pre;
    }, {});

    const updateRecordSql = this.knex(dbTableName)
      .update(updateColumns)
      .updateFrom(tempTableName)
      .where(`${dbTableName}.${idFieldName}`, this.knex.ref(`${tempTableName}.${idFieldName}`))
      .toQuery();

    return { insertTempTableSql, updateRecordSql };
  }

  aggregationFunction(dbTableName: string, field: IFieldInstance): IAggregationFunctionInterface {
    return new AggregationFunctionPostgres(this.knex, dbTableName, field);
  }

  filterQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [p: string]: IFieldInstance },
    filter?: IFilter | null
  ): IFilterQueryInterface {
    return new FilterQueryPostgres(originQueryBuilder, fields, filter);
  }
}
