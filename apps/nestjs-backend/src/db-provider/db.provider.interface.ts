import type { DriverClient, IFilter } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { IAggregationFunctionInterface } from './aggregation/aggregation-function.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';

export interface IDbProvider {
  driver: DriverClient;

  createSchema(schemaName: string): string[] | undefined;

  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string;

  executeUpdateRecordsSqlList(params: {
    dbTableName: string;
    tempTableName: string;
    idFieldName: string;
    dbFieldNames: string[];
    data: { id: string; values: { [key: string]: unknown } }[];
  }): { insertTempTableSql: string; updateRecordSql: string };

  aggregationFunction(dbTableName: string, field: IFieldInstance): IAggregationFunctionInterface;

  filterQuery(
    originKnex: Knex.QueryBuilder,
    fields?: { [fieldId: string]: IFieldInstance },
    filter?: IFilter | null
  ): IFilterQueryInterface;
}
