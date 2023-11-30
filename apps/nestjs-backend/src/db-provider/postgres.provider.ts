import { Logger } from '@nestjs/common';
import type { IFilter } from '@teable-group/core';
import { DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
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
      `create schema if not exists "${schemaName}"`,
      `revoke all on schema "${schemaName}" from public`,
    ];
  }

  generateDbTableName(baseId: string, name: string) {
    return `${baseId}.${name}`;
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
