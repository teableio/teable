import type {
  DriverClient,
  FieldCore,
  FieldType,
  IFilter,
  ILookupLinkOptionsVo,
  ILookupOptionsVo,
  ISortItem,
  TableDomain,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import type { IAggregationField, ISearchIndexByQueryRo, TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { DateFieldDto } from '../features/field/model/field-dto/date-field.dto';
import type { IFieldSelectName } from '../features/record/query-builder/field-select.type';
import type {
  IRecordQueryFilterContext,
  IRecordQuerySortContext,
  IRecordQueryGroupContext,
  IRecordQueryAggregateContext,
} from '../features/record/query-builder/record-query-builder.interface';
import type {
  IFormulaConversionContext,
  IFormulaConversionResult,
  IGeneratedColumnQueryInterface,
  ISelectFormulaConversionContext,
  ISelectQueryInterface,
} from '../features/record/query-builder/sql-conversion.visitor';
import type { IAggregationQueryInterface } from './aggregation-query/aggregation-query.interface';
import type { BaseQueryAbstract } from './base-query/abstract';
import type { DropColumnOperationType } from './drop-database-column-query/drop-database-column-field-visitor.interface';
import type { DuplicateTableQueryAbstract } from './duplicate-table/abstract';
import type { DuplicateAttachmentTableQueryAbstract } from './duplicate-table/duplicate-attachment-table-query.abstract';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import type { IGroupQueryExtra, IGroupQueryInterface } from './group-query/group-query.interface';
import type { IndexBuilderAbstract } from './index-query/index-abstract-builder';
import type { IntegrityQueryAbstract } from './integrity-query/abstract';
import type { ISortQueryInterface } from './sort-query/sort-query.interface';

export type IFilterQueryExtra = {
  withUserId?: string;

  [key: string]: unknown;
};

export type ISortQueryExtra = {
  [key: string]: unknown;
};

export type IAggregationQueryExtra = { filter?: IFilter; groupBy?: string[] } & IFilterQueryExtra;

export type ICalendarDailyCollectionQueryProps = {
  startDate: string;
  endDate: string;
  startField: DateFieldDto;
  endField: DateFieldDto;
  dbTableName: string;
};

export interface IDbProvider {
  driver: DriverClient;

  createSchema(schemaName: string): string[] | undefined;

  dropSchema(schemaName: string): string | undefined;

  generateDbTableName(baseId: string, name: string): string;

  renameTableName(oldTableName: string, newTableName: string): string[];

  getForeignKeysInfo(dbTableName: string): string;

  dropTable(tableName: string): string;

  renameColumn(tableName: string, oldName: string, newName: string): string[];

  dropColumn(
    tableName: string,
    fieldInstance: IFieldInstance,
    linkContext?: { tableId: string; tableNameMap: Map<string, string> },
    operationType?: DropColumnOperationType
  ): string[];

  updateJsonColumn(
    tableName: string,
    columnName: string,
    id: string,
    key: string,
    value: string
  ): string;

  updateJsonArrayColumn(
    tableName: string,
    columnName: string,
    id: string,
    key: string,
    value: string
  ): string;

  // sql response format: { name: string }[], name for columnName.
  columnInfo(tableName: string): string;

  checkColumnExist(
    tableName: string,
    columnName: string,
    prisma: Prisma.TransactionClient
  ): Promise<boolean>;

  checkTableExist(tableName: string): string;

  dropColumnAndIndex(tableName: string, columnName: string, indexName: string): string[];

  modifyColumnSchema(
    tableName: string,
    oldFieldInstance: IFieldInstance,
    fieldInstance: IFieldInstance,
    tableDomain: TableDomain,
    linkContext?: { tableId: string; tableNameMap: Map<string, string> }
  ): string[];

  createColumnSchema(
    tableName: string,
    fieldInstance: IFieldInstance,
    tableDomain: TableDomain,
    isNewTable: boolean,
    tableId: string,
    tableNameMap: Map<string, string>,
    isSymmetricField?: boolean,
    skipBaseColumnCreation?: boolean
  ): string[];

  duplicateTable(
    fromSchema: string,
    toSchema: string,
    tableName: string,
    withData?: boolean
  ): string;

  alterAutoNumber(tableName: string): string[];

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

  updateFromSelectSql(params: {
    dbTableName: string;
    idFieldName: string;
    subQuery: Knex.QueryBuilder;
    dbFieldNames: string[];
    returningDbFieldNames?: string[];
  }): string;

  aggregationQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    aggregationFields?: IAggregationField[],
    extra?: IAggregationQueryExtra,
    context?: IRecordQueryAggregateContext
  ): IAggregationQueryInterface;

  filterQuery(
    originKnex: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    filter?: IFilter,
    extra?: IFilterQueryExtra,
    context?: IRecordQueryFilterContext
  ): IFilterQueryInterface;

  sortQuery(
    originKnex: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    sortObjs?: ISortItem[],
    extra?: ISortQueryExtra,
    context?: IRecordQuerySortContext
  ): ISortQueryInterface;

  groupQuery(
    originKnex: Knex.QueryBuilder,
    fieldMap?: { [fieldId: string]: FieldCore },
    groupFieldIds?: string[],
    extra?: IGroupQueryExtra,
    context?: IRecordQueryGroupContext
  ): IGroupQueryInterface;

  searchQuery(
    originQueryBuilder: Knex.QueryBuilder,
    searchFields: IFieldInstance[],
    tableIndex: TableIndex[],
    search: [string, string?, boolean?],
    context?: IRecordQueryFilterContext
  ): Knex.QueryBuilder;

  searchIndexQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    searchField: IFieldInstance[],
    searchIndexRo: Partial<ISearchIndexByQueryRo>,
    tableIndex: TableIndex[],
    context?: IRecordQueryFilterContext,
    baseSortIndex?: string,
    setFilterQuery?: (qb: Knex.QueryBuilder) => void,
    setSortQuery?: (qb: Knex.QueryBuilder) => void
  ): Knex.QueryBuilder;

  searchCountQuery(
    originQueryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    search: [string, string?, boolean?],
    tableIndex: TableIndex[],
    context?: IRecordQueryFilterContext
  ): Knex.QueryBuilder;

  searchIndex(): IndexBuilderAbstract;

  duplicateTableQuery(queryBuilder: Knex.QueryBuilder): DuplicateTableQueryAbstract;

  duplicateAttachmentTableQuery(
    queryBuilder: Knex.QueryBuilder
  ): DuplicateAttachmentTableQueryAbstract;

  shareFilterCollaboratorsQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbFieldName: string,
    isMultipleCellValue?: boolean | null
  ): void;

  baseQuery(): BaseQueryAbstract;

  integrityQuery(): IntegrityQueryAbstract;

  calendarDailyCollectionQuery(
    qb: Knex.QueryBuilder,
    props: ICalendarDailyCollectionQueryProps
  ): Knex.QueryBuilder;

  lookupOptionsQuery(optionsKey: keyof ILookupLinkOptionsVo, value: string): string;

  optionsQuery(type: FieldType, optionsKey: string, value: string): string;

  searchBuilder(qb: Knex.QueryBuilder, search: [string, string][]): Knex.QueryBuilder;

  getTableIndexes(dbTableName: string): string;

  generatedColumnQuery(): IGeneratedColumnQueryInterface;

  convertFormulaToGeneratedColumn(
    expression: string,
    context: IFormulaConversionContext
  ): IFormulaConversionResult;

  selectQuery(): ISelectQueryInterface;

  convertFormulaToSelectQuery(
    expression: string,
    context: ISelectFormulaConversionContext
  ): IFieldSelectName;

  generateDatabaseViewName(tableId: string): string;
  createDatabaseView(
    table: TableDomain,
    qb: Knex.QueryBuilder,
    options?: { materialized?: boolean }
  ): string[];
  recreateDatabaseView(table: TableDomain, qb: Knex.QueryBuilder): string[];
  dropDatabaseView(tableId: string): string[];
  refreshDatabaseView(tableId: string, options?: { concurrently?: boolean }): string | undefined;

  createMaterializedView(table: TableDomain, qb: Knex.QueryBuilder): string;
  dropMaterializedView(tableId: string): string;
}
