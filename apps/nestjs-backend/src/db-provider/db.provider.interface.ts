import type { DriverClient, IAggregationField, IFilter, ISortItem } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { SchemaType } from '../features/field/util';
import type { IAggregationQueryInterface } from './aggregation-query/aggregation-query.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import type { ISortQueryInterface } from './sort-query/sort-query.interface';

export type IFilterQueryExtra = {
  withUserId?: string;

  [key: string]: unknown;
};

export type ISortQueryExtra = {
  [key: string]: unknown;
};

export type IAggregationQueryExtra = { filter?: IFilter } & IFilterQueryExtra;

export interface IDbProvider {
  driver: DriverClient;

  createSchema(schemaName: string): string[] | undefined;

  generateDbTableName(baseId: string, name: string): string;

  renameTableName(oldTableName: string, newTableName: string): string[];

  dropTable(tableName: string): string;

  renameColumnName(tableName: string, oldName: string, newName: string): string[];

  dropColumn(tableName: string, columnName: string): string[];

  // sql response format: { name: string }[], name for columnName.
  columnInfo(tableName: string, columnName: string): string;

  dropColumnAndIndex(tableName: string, columnName: string, indexName: string): string[];

  modifyColumnSchema(tableName: string, columnName: string, schemaType: SchemaType): string[];

  duplicateTable(
    fromSchema: string,
    toSchema: string,
    tableName: string,
    withData?: boolean
  ): string;

  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string;

  splitTableName(tableName: string): string[];

  joinDbTableName(schemaName: string, dbTableName: string): string;

  executeUpdateRecordsSqlList(params: {
    dbTableName: string;
    tempTableName: string;
    idFieldName: string;
    dbFieldNames: string[];
    data: { id: string; values: { [key: string]: unknown } }[];
  }): { insertTempTableSql: string; updateRecordSql: string };

  aggregationQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    fields?: { [fieldId: string]: IFieldInstance },
    aggregationFields?: IAggregationField[],
    extra?: IAggregationQueryExtra
  ): IAggregationQueryInterface;

  filterQuery(
    originKnex: Knex.QueryBuilder,
    fields?: { [fieldId: string]: IFieldInstance },
    filter?: IFilter,
    extra?: IFilterQueryExtra
  ): IFilterQueryInterface;

  sortQuery(
    originKnex: Knex.QueryBuilder,
    fields?: { [fieldId: string]: IFieldInstance },
    sortObjs?: ISortItem[],
    extra?: ISortQueryExtra
  ): ISortQueryInterface;
}
