import { Logger } from '@nestjs/common';
import type { IAggregationField, IFilter, ISortItem } from '@teable-group/core';
import { DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { SchemaType } from '../features/field/util';
import type { IAggregationQueryInterface } from './aggregation-query/aggregation-query.interface';
import { AggregationQueryPostgres } from './aggregation-query/postgres/aggregation-query.postgres';
import type {
  IAggregationQueryExtra,
  IDbProvider,
  IFilterQueryExtra,
  ISortQueryExtra,
} from './db.provider.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQueryPostgres } from './filter-query/postgres/filter-query.postgres';
import type { ISortQueryInterface } from './sort-query/sort-query.interface';
import { SortQueryPostgres } from './sort-query/sort-query.postgres';

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
    return [
      this.knex.schema
        .alterTable(tableName, (table) => {
          table.dropColumn(columnName);
        })
        .toQuery(),
      this.knex.schema
        .alterTable(tableName, (table) => {
          table[schemaType](columnName);
        })
        .toQuery(),
    ];
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

  aggregationQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    fields?: { [fieldId: string]: IFieldInstance },
    aggregationFields?: IAggregationField[],
    extra?: IAggregationQueryExtra
  ): IAggregationQueryInterface {
    return new AggregationQueryPostgres(
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
    fields?: { [fieldId: string]: IFieldInstance },
    filter?: IFilter,
    extra?: IFilterQueryExtra
  ): IFilterQueryInterface {
    return new FilterQueryPostgres(originQueryBuilder, fields, filter, extra);
  }

  sortQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: IFieldInstance },
    sortObjs?: ISortItem[],
    extra?: ISortQueryExtra
  ): ISortQueryInterface {
    return new SortQueryPostgres(this.knex, originQueryBuilder, fields, sortObjs, extra);
  }
}
