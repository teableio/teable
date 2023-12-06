import type { DriverClient, IFilter } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { SchemaType } from '../features/field/util';
import type { IAggregationFunctionInterface } from './aggregation/aggregation-function.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';

export interface IDbProvider {
  driver: DriverClient;

  createSchema(schemaName: string): string[] | undefined;

  generateDbTableName(baseId: string, name: string): string;

  renameTableName(oldTableName: string, newTableName: string): string[];

  renameColumnName(tableName: string, oldName: string, newName: string): string[];

  dropColumn(tableName: string, columnName: string): string[];

  // sql response format: { name: string }[], name for columnName.
  columnInfo(tableName: string, columnName: string): string;

  modifyColumnSchema(tableName: string, columnName: string, schemaType: SchemaType): string[];

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
