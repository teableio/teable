import { Logger } from '@nestjs/common';
import type { IFilter } from '@teable-group/core';
import { DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { IAggregationFunctionInterface } from './aggregation/aggregation-function.interface';
import { AggregationFunctionSqlite } from './aggregation/aggregation-function.sqlite';
import type { IDbProvider } from './db.provider.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQuerySqlite } from './filter-query/sqlite/filter-query.sqlite';

export class SqliteProvider implements IDbProvider {
  private readonly logger = new Logger(SqliteProvider.name);

  constructor(private readonly knex: Knex) {}

  driver = DriverClient.Sqlite;

  createSchema(_schemaName: string) {
    return undefined;
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
    const insertTempTableSql = this.batchInsertSql(dbTableName, insertRowsData);

    // update data
    const updateColumns = dbFieldNames.reduce<{ [key: string]: unknown }>((pre, columnName) => {
      pre[columnName] = this.knex.ref(`${tempTableName}.${columnName}`);
      return pre;
    }, {});
    let updateRecordSql = this.knex(dbTableName).update(updateColumns).toQuery();
    updateRecordSql += ` FROM \`${tempTableName}\` WHERE ${dbTableName}.${idFieldName} = ${tempTableName}.${idFieldName}`;

    return { insertTempTableSql, updateRecordSql };
  }

  aggregationFunction(dbTableName: string, field: IFieldInstance): IAggregationFunctionInterface {
    return new AggregationFunctionSqlite(this.knex, dbTableName, field);
  }

  filterQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [p: string]: IFieldInstance },
    filter?: IFilter | null
  ): IFilterQueryInterface {
    return new FilterQuerySqlite(originQueryBuilder, fields, filter);
  }
}
