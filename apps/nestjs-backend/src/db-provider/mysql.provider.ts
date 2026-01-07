/* eslint-disable sonarjs/no-duplicate-string */
import { Logger } from '@nestjs/common';
import type {
  IFilter,
  ILookupLinkOptionsVo,
  ISortItem,
  TableDomain,
  FieldCore,
} from '@teable/core';
import { DriverClient, parseFormulaToSQL, FieldType } from '@teable/core';
import type { PrismaClient } from '@teable/db-main-prisma';
import type { IAggregationField, ISearchIndexByQueryRo, TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type {
  IRecordQueryFilterContext,
  IRecordQuerySortContext,
  IRecordQueryGroupContext,
  IRecordQueryAggregateContext,
} from '../features/record/query-builder/record-query-builder.interface';
import type {
  IGeneratedColumnQueryInterface,
  IFormulaConversionContext,
  IFormulaConversionResult,
  ISelectQueryInterface,
  ISelectFormulaConversionContext,
} from '../features/record/query-builder/sql-conversion.visitor';
import {
  GeneratedColumnSqlConversionVisitor,
  SelectColumnSqlConversionVisitor,
} from '../features/record/query-builder/sql-conversion.visitor';
import type { IAggregationQueryInterface } from './aggregation-query/aggregation-query.interface';
import { AggregationQueryPostgres } from './aggregation-query/postgres/aggregation-query.postgres';
import type { BaseQueryAbstract } from './base-query/abstract';
import { BaseQueryPostgres } from './base-query/base-query.postgres';
import type { ICreateDatabaseColumnContext } from './create-database-column-query/create-database-column-field-visitor.interface';
import { CreatePostgresDatabaseColumnFieldVisitor } from './create-database-column-query/create-database-column-field-visitor.postgres';
import type {
  IAggregationQueryExtra,
  ICalendarDailyCollectionQueryProps,
  IDbProvider,
  IFilterQueryExtra,
  ISortQueryExtra,
} from './db.provider.interface';
import type {
  IDropDatabaseColumnContext,
  DropColumnOperationType,
} from './drop-database-column-query/drop-database-column-field-visitor.interface';
import { DropPostgresDatabaseColumnFieldVisitor } from './drop-database-column-query/drop-database-column-field-visitor.postgres';
import { DuplicateAttachmentTableQueryPostgres } from './duplicate-table/duplicate-attachment-table-query.postgres';
import { DuplicateTableQueryPostgres } from './duplicate-table/duplicate-query.postgres';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQueryPostgres } from './filter-query/postgres/filter-query.postgres';
import { GeneratedColumnQueryPostgres } from './generated-column-query/postgres/generated-column-query.postgres';
import type { IGroupQueryExtra, IGroupQueryInterface } from './group-query/group-query.interface';
import { GroupQueryPostgres } from './group-query/group-query.postgres';
import type { IntegrityQueryAbstract } from './integrity-query/abstract';
import { IntegrityQueryPostgres } from './integrity-query/integrity-query.postgres';
import { SearchQueryAbstract } from './search-query/abstract';
import { IndexBuilderPostgres } from './search-query/search-index-builder.postgres';
import {
  SearchQueryPostgresBuilder,
  SearchQueryPostgres,
} from './search-query/search-query.postgres';
import { SelectQueryPostgres } from './select-query/postgres/select-query.postgres';
import { SortQueryPostgres } from './sort-query/postgres/sort-query.postgres';
import type { ISortQueryInterface } from './sort-query/sort-query.interface';

export class MysqlProvider implements IDbProvider {
  private readonly logger = new Logger(MysqlProvider.name);
  constructor(private readonly knex: Knex) {}

  driver = DriverClient.Mysql;

  // MySQL uses databases (schemas are synonyms in MySQL 8+)
  createSchema(schemaName: string) {
    return [
      this.knex.raw(`CREATE DATABASE IF NOT EXISTS ??`, [schemaName]).toQuery(),
      // MySQL doesn't have schema-level permissions like Postgres, so we skip the revoke
    ];
  }

  dropSchema(schemaName: string): string {
    return this.knex.raw(`DROP DATABASE IF EXISTS ??`, [schemaName]).toQuery();
  }

  generateDbTableName(baseId: string, name: string) {
    return `${baseId}.${name}`;
  }

  getForeignKeysInfo(dbTableName: string) {
    const [schemaName, tableName] = this.splitTableName(dbTableName);
    return this.knex
      .raw(
        `
      SELECT 
        CONSTRAINT_NAME as constraint_name,
        COLUMN_NAME as column_name,
        REFERENCED_TABLE_SCHEMA as referenced_table_schema,
        REFERENCED_TABLE_NAME as referenced_table_name,
        REFERENCED_COLUMN_NAME as referenced_column_name
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
      `,
        [schemaName, tableName]
      )
      .toQuery();
  }

  renameTableName(oldTableName: string, newTableName: string) {
    const nameWithoutSchema = this.splitTableName(newTableName)[1];
    return [
      this.knex.raw('ALTER TABLE ?? RENAME TO ??', [oldTableName, nameWithoutSchema]).toQuery(),
    ];
  }

  dropTable(tableName: string): string {
    return this.knex.raw('DROP TABLE IF EXISTS ??', [tableName]).toQuery();
  }

  async checkColumnExist(
    tableName: string,
    columnName: string,
    prisma: PrismaClient
  ): Promise<boolean> {
    const [schemaName, dbTableName] = this.splitTableName(tableName);
    const sql = this.knex
      .raw(
        'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?) AS `exists`',
        [schemaName, dbTableName, columnName]
      )
      .toQuery();
    const res = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(sql);
    return res[0].exists;
  }

  checkTableExist(tableName: string): string {
    const [schemaName, dbTableName] = this.splitTableName(tableName);
    return this.knex
      .raw(
        'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?) AS `exists`',
        [schemaName, dbTableName]
      )
      .toQuery();
  }

  renameColumn(tableName: string, oldName: string, newName: string): string[] {
    return this.knex.schema
      .alterTable(tableName, (table: Knex.AlterTableBuilder) => {
        table.renameColumn(oldName, newName);
      })
      .toSQL()
      .map((item: { sql: string }) => item.sql);
  }

  dropColumn(
    tableName: string,
    fieldInstance: IFieldInstance,
    linkContext?: { tableId: string; tableNameMap: Map<string, string> },
    operationType?: DropColumnOperationType
  ): string[] {
    const context: IDropDatabaseColumnContext = {
      tableName,
      knex: this.knex,
      linkContext,
      operationType,
    };

    // Use visitor pattern to drop columns (reusing Postgres visitor for now)
    const visitor = new DropPostgresDatabaseColumnFieldVisitor(context);
    return fieldInstance.accept(visitor);
  }

  dropColumnAndIndex(tableName: string, columnName: string, indexName: string): string[] {
    return [
      this.knex.raw(`DROP INDEX ?? ON ??`, [indexName, tableName]).toQuery(),
      this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [tableName, columnName]).toQuery(),
    ];
  }

  columnInfo(tableName: string): string {
    const [schemaName, dbTableName] = tableName.split('.');
    return this.knex
      .select({
        name: 'COLUMN_NAME',
      })
      .from('information_schema.columns')
      .where({
        TABLE_SCHEMA: schemaName,
        TABLE_NAME: dbTableName,
      })
      .toQuery();
  }

  updateJsonColumn(
    tableName: string,
    columnName: string,
    id: string,
    key: string,
    value: string
  ): string {
    return this.knex(tableName)
      .where(this.knex.raw(`JSON_EXTRACT(??, '$.id') = ?`, [columnName, id]))
      .update({
        [columnName]: this.knex.raw(
          `
        JSON_SET(
          ??,
          ?,
          ?
        )
      `,
          [columnName, `$.${key}`, value]
        ),
      })
      .toQuery();
  }

  updateJsonArrayColumn(
    tableName: string,
    columnName: string,
    id: string,
    key: string,
    value: string
  ): string {
    // MySQL JSON array update is more complex, using a subquery approach
    return this.knex(tableName)
      .update({
        [columnName]: this.knex.raw(
          `
          JSON_ARRAYAGG(
            CASE
              WHEN JSON_EXTRACT(value, '$.id') = ?
              THEN JSON_SET(value, ?, ?)
              ELSE value
            END
          )
        `,
          [id, `$.${key}`, value]
        ),
      })
      .toQuery();
  }

  modifyColumnSchema(
    tableName: string,
    oldFieldInstance: IFieldInstance,
    fieldInstance: IFieldInstance,
    tableDomain: TableDomain,
    linkContext?: { tableId: string; tableNameMap: Map<string, string> }
  ): string[] {
    const queries: string[] = [];

    // First, drop ALL columns associated with the field (including generated columns)
    queries.push(...this.dropColumn(tableName, oldFieldInstance, linkContext));

    // For Link fields, delegate creation to link service to avoid double creation
    if (fieldInstance.type === FieldType.Link && !fieldInstance.isLookup) {
      return queries;
    }

    const alterTableBuilder = this.knex.schema.alterTable(tableName, (table) => {
      const createContext: ICreateDatabaseColumnContext = {
        table: table as any, // AlterTableBuilder is compatible with CreateTableBuilder for column operations
        field: fieldInstance,
        fieldId: fieldInstance.id,
        dbFieldName: fieldInstance.dbFieldName,
        unique: fieldInstance.unique,
        notNull: fieldInstance.notNull,
        dbProvider: this,
        tableDomain,
        tableId: linkContext?.tableId || '',
        tableName,
        knex: this.knex,
        tableNameMap: linkContext?.tableNameMap || new Map(),
      };

      // Use visitor pattern to recreate columns (reusing Postgres visitor for now)
      const visitor = new CreatePostgresDatabaseColumnFieldVisitor(createContext);
      fieldInstance.accept(visitor);
    });

    const alterTableQueries = alterTableBuilder.toSQL().map((item: { sql: string }) => item.sql);
    queries.push(...alterTableQueries);

    return queries;
  }

  createColumnSchema(
    tableName: string,
    fieldInstance: IFieldInstance,
    tableDomain: TableDomain,
    isNewTable: boolean,
    tableId: string,
    tableNameMap: Map<string, string>,
    isSymmetricField?: boolean,
    skipBaseColumnCreation?: boolean
  ): string[] {
    let visitor: CreatePostgresDatabaseColumnFieldVisitor | undefined = undefined;
    const alterTableBuilder = this.knex.schema.alterTable(tableName, (table) => {
      const context: ICreateDatabaseColumnContext = {
        table: table as any, // AlterTableBuilder is compatible with CreateTableBuilder for column operations
        field: fieldInstance,
        fieldId: fieldInstance.id,
        dbFieldName: fieldInstance.dbFieldName,
        unique: fieldInstance.unique,
        notNull: fieldInstance.notNull,
        dbProvider: this,
        tableDomain,
        isNewTable,
        tableId,
        tableName,
        knex: this.knex,
        tableNameMap,
        isSymmetricField,
        skipBaseColumnCreation,
      };
      visitor = new CreatePostgresDatabaseColumnFieldVisitor(context);
      fieldInstance.accept(visitor);
    });

    const mainSqls = alterTableBuilder.toSQL().map((item: { sql: string }) => item.sql);
    const additionalSqls =
      (visitor as CreatePostgresDatabaseColumnFieldVisitor | undefined)?.getSql() ?? [];

    return [...mainSqls, ...additionalSqls];
  }

  splitTableName(tableName: string): string[] {
    return tableName.split('.');
  }

  joinDbTableName(schemaName: string, dbTableName: string) {
    return `${schemaName}.${dbTableName}`;
  }

  duplicateTable(
    fromSchema: string,
    toSchema: string,
    tableName: string,
    withData?: boolean
  ): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, dbTableName] = this.splitTableName(tableName);
    return (
      this.knex
        .raw(`CREATE TABLE ??.?? LIKE ??.??`, [toSchema, dbTableName, fromSchema, dbTableName])
        .toQuery() +
      (withData
        ? `; INSERT INTO ${toSchema}.${dbTableName} SELECT * FROM ${fromSchema}.${dbTableName}`
        : '')
    );
  }

  alterAutoNumber(_tableName: string): string[] {
    // MySQL uses AUTO_INCREMENT, which is typically set at table creation
    // This would require ALTER TABLE to modify the column
    return [];
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

    // update data using JOIN
    const updateColumns = dbFieldNames.reduce<{ [key: string]: unknown }>((pre, columnName) => {
      pre[columnName] = this.knex.ref(`${tempTableName}.${columnName}`);
      return pre;
    }, {});

    const updateRecordSql = this.knex(dbTableName)
      .join(tempTableName, `${dbTableName}.${idFieldName}`, '=', `${tempTableName}.${idFieldName}`)
      .update(updateColumns)
      .toQuery();

    return { insertTempTableSql, updateRecordSql };
  }

  updateFromSelectSql(params: {
    dbTableName: string;
    idFieldName: string;
    subQuery: Knex.QueryBuilder;
    dbFieldNames: string[];
    returningDbFieldNames?: string[];
    restrictRecordIds?: string[];
  }): string {
    const {
      dbTableName,
      idFieldName,
      subQuery,
      dbFieldNames,
      returningDbFieldNames,
      restrictRecordIds,
    } = params;
    const subQuerySql = subQuery.toQuery();
    const alias = '__s';
    const updateColumns = dbFieldNames.reduce<{ [key: string]: unknown }>((acc, name) => {
      acc[name] = this.knex.ref(`${alias}.${name}`);
      return acc;
    }, {});
    // bump version on target table
    updateColumns['__version'] = this.knex.raw('?? + 1', [`${dbTableName}.__version`]);

    const builder = this.knex(dbTableName)
      .join(
        this.knex.raw(`(${subQuerySql}) AS ??`, [alias]),
        `${dbTableName}.${idFieldName}`,
        '=',
        `${alias}.${idFieldName}`
      )
      .update(updateColumns);

    if (restrictRecordIds?.length) {
      builder.whereIn(`${dbTableName}.${idFieldName}`, restrictRecordIds);
    }

    // MySQL doesn't support RETURNING, so we'll need to do a separate SELECT
    // For now, return the UPDATE query
    return builder.toQuery();
  }

  aggregationQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    aggregationFields?: IAggregationField[],
    extra?: IAggregationQueryExtra,
    context?: IRecordQueryAggregateContext
  ): IAggregationQueryInterface {
    // Reusing Postgres aggregation for now
    return new AggregationQueryPostgres(
      this.knex,
      originQueryBuilder,
      fields,
      aggregationFields,
      extra,
      context
    );
  }

  filterQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [p: string]: FieldCore },
    filter?: IFilter,
    extra?: IFilterQueryExtra,
    context?: IRecordQueryFilterContext
  ): IFilterQueryInterface {
    // Reusing Postgres filter for now
    return new FilterQueryPostgres(originQueryBuilder, fields, filter, extra, this, context);
  }

  sortQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    sortObjs?: ISortItem[],
    extra?: ISortQueryExtra,
    context?: IRecordQuerySortContext
  ): ISortQueryInterface {
    return new SortQueryPostgres(this.knex, originQueryBuilder, fields, sortObjs, extra, context);
  }

  groupQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fieldMap?: { [fieldId: string]: IFieldInstance },
    groupFieldIds?: string[],
    extra?: IGroupQueryExtra,
    context?: IRecordQueryGroupContext
  ): IGroupQueryInterface {
    return new GroupQueryPostgres(
      this.knex,
      originQueryBuilder,
      fieldMap,
      groupFieldIds,
      extra,
      context
    );
  }

  searchQuery(
    originQueryBuilder: Knex.QueryBuilder,
    searchFields: IFieldInstance[],
    tableIndex: TableIndex[],
    search: [string, string?, boolean?],
    context?: IRecordQueryFilterContext
  ) {
    return SearchQueryAbstract.appendQueryBuilder(
      SearchQueryPostgres,
      originQueryBuilder,
      searchFields,
      tableIndex,
      search,
      context
    );
  }

  searchCountQuery(
    originQueryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    search: [string, string?, boolean?],
    tableIndex: TableIndex[],
    context?: IRecordQueryFilterContext
  ) {
    return SearchQueryAbstract.buildSearchCountQuery(
      SearchQueryPostgres,
      originQueryBuilder,
      searchField,
      search,
      tableIndex,
      context
    );
  }

  searchIndexQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    searchField: IFieldInstance[],
    searchIndexRo: ISearchIndexByQueryRo,
    tableIndex: TableIndex[],
    context?: IRecordQueryFilterContext,
    baseSortIndex?: string,
    setFilterQuery?: (qb: Knex.QueryBuilder) => void,
    setSortQuery?: (qb: Knex.QueryBuilder) => void
  ) {
    return new SearchQueryPostgresBuilder(
      originQueryBuilder,
      dbTableName,
      searchField,
      searchIndexRo,
      tableIndex,
      context,
      baseSortIndex,
      setFilterQuery,
      setSortQuery
    ).getSearchIndexQuery();
  }

  searchIndex() {
    return new IndexBuilderPostgres();
  }

  duplicateTableQuery(queryBuilder: Knex.QueryBuilder) {
    return new DuplicateTableQueryPostgres(queryBuilder);
  }

  duplicateAttachmentTableQuery(queryBuilder: Knex.QueryBuilder) {
    return new DuplicateAttachmentTableQueryPostgres(queryBuilder);
  }

  shareFilterCollaboratorsQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbFieldName: string,
    isMultipleCellValue?: boolean | null
  ) {
    if (isMultipleCellValue) {
      originQueryBuilder.distinct(
        this.knex.raw(`JSON_EXTRACT(JSON_EXTRACT(??, '$[*]'), '$.id') AS user_id`, [dbFieldName])
      );
    } else {
      originQueryBuilder.distinct(
        this.knex.raw(`JSON_EXTRACT(??, '$.id') AS user_id`, [dbFieldName])
      );
    }
  }

  baseQuery(): BaseQueryAbstract {
    return new BaseQueryPostgres(this.knex);
  }

  integrityQuery(): IntegrityQueryAbstract {
    return new IntegrityQueryPostgres(this.knex);
  }

  calendarDailyCollectionQuery(
    qb: Knex.QueryBuilder,
    props: ICalendarDailyCollectionQueryProps
  ): Knex.QueryBuilder {
    const { startDate, endDate, startField, endField, dbTableName } = props;
    const timezone = startField.options.formatting.timeZone;

    // MySQL date generation using recursive CTE (MySQL 8.0+)
    const datesSubquery = this.knex.raw(
      `WITH RECURSIVE dates(date) AS (
        SELECT DATE(?) as date
        UNION ALL
        SELECT DATE_ADD(date, INTERVAL 1 DAY)
        FROM dates
        WHERE date < DATE(?)
      )
      SELECT date FROM dates`,
      [startDate, endDate]
    );

    return qb
      .select([
        this.knex.raw('d.date'),
        this.knex.raw('COUNT(*) as count'),
        this.knex.raw('GROUP_CONCAT(?? ORDER BY ??.??) as ids', [
          '__id',
          dbTableName,
          startField.dbFieldName,
        ]),
      ])
      .crossJoin(datesSubquery.wrap('(', ') as d'))
      .where((builder: Knex.QueryBuilder) => {
        builder
          .where(`${dbTableName}.${endField.dbFieldName}`, '<', endDate)
          .andWhere(
            this.knex.raw(`COALESCE(??.??, ??.??) >= ?`, [
              dbTableName,
              endField.dbFieldName,
              dbTableName,
              startField.dbFieldName,
              startDate,
            ])
          );
      })
      .andWhere((builder: Knex.QueryBuilder) => {
        builder.whereRaw(`DATE(??.??) <= d.date AND DATE(COALESCE(??.??, ??.??)) >= d.date`, [
          dbTableName,
          startField.dbFieldName,
          dbTableName,
          endField.dbFieldName,
          dbTableName,
          startField.dbFieldName,
        ]);
      })
      .groupBy('d.date')
      .orderBy('d.date', 'asc');
  }

  lookupOptionsQuery(optionsKey: keyof ILookupLinkOptionsVo, value: string): string {
    return this.knex('field')
      .select({
        tableId: 'table_id',
        id: 'id',
        type: 'type',
        name: 'name',
        lookupOptions: 'lookup_options',
      })
      .whereNull('deleted_time')
      .whereRaw(`JSON_EXTRACT(lookup_options, ?) = ?`, [`$.${String(optionsKey)}`, value])
      .toQuery();
  }

  optionsQuery(type: FieldType, optionsKey: string, value: string): string {
    return this.knex('field')
      .select({
        tableId: 'table_id',
        id: 'id',
        name: 'name',
        description: 'description',
        notNull: 'not_null',
        unique: 'unique',
        isPrimary: 'is_primary',
        dbFieldName: 'db_field_name',
        isComputed: 'is_computed',
        isPending: 'is_pending',
        hasError: 'has_error',
        dbFieldType: 'db_field_type',
        isMultipleCellValue: 'is_multiple_cell_value',
        isLookup: 'is_lookup',
        lookupOptions: 'lookup_options',
        type: 'type',
        options: 'options',
        cellValueType: 'cell_value_type',
      })
      .whereNull('deleted_time')
      .whereNull('is_lookup')
      .whereRaw(`JSON_EXTRACT(options, ?) = ?`, [`$.${optionsKey}`, value])
      .where('type', type)
      .toQuery();
  }

  searchBuilder(qb: Knex.QueryBuilder, search: [string, string][]): Knex.QueryBuilder {
    return qb.where((builder) => {
      search.forEach(([field, value]) => {
        builder.orWhereRaw('LOWER(??) LIKE LOWER(?)', [field, `%${value}%`]);
      });
    });
  }

  getTableIndexes(dbTableName: string): string {
    const [schemaName, tableName] = this.splitTableName(dbTableName);
    return this.knex
      .raw(
        `
        SELECT
          INDEX_NAME AS name,
          NON_UNIQUE = 0 AS isUnique,
          GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
        GROUP BY INDEX_NAME, NON_UNIQUE
        ORDER BY INDEX_NAME
      `,
        [schemaName, tableName]
      )
      .toQuery();
  }

  generatedColumnQuery(): IGeneratedColumnQueryInterface {
    return new GeneratedColumnQueryPostgres();
  }

  convertFormulaToGeneratedColumn(
    expression: string,
    context: IFormulaConversionContext
  ): IFormulaConversionResult {
    try {
      const generatedColumnQuery = this.generatedColumnQuery();
      const contextWithDriver = { ...context, driverClient: this.driver };
      generatedColumnQuery.setContext(contextWithDriver);

      const visitor = new GeneratedColumnSqlConversionVisitor(
        this.knex,
        generatedColumnQuery,
        contextWithDriver
      );

      const sql = parseFormulaToSQL(expression, visitor);

      return visitor.getResult(sql);
    } catch (error) {
      throw new Error(`Failed to convert formula: ${(error as Error).message}`);
    }
  }

  selectQuery(): ISelectQueryInterface {
    return new SelectQueryPostgres();
  }

  convertFormulaToSelectQuery(
    expression: string,
    context: ISelectFormulaConversionContext
  ): string {
    try {
      const selectQuery = this.selectQuery();
      const contextWithDriver = { ...context, driverClient: this.driver };
      selectQuery.setContext(contextWithDriver);

      const visitor = new SelectColumnSqlConversionVisitor(
        this.knex,
        selectQuery,
        contextWithDriver
      );

      return parseFormulaToSQL(expression, visitor);
    } catch (error) {
      throw new Error(`Failed to convert formula: ${(error as Error).message}`);
    }
  }

  generateDatabaseViewName(tableId: string): string {
    return tableId + '_view';
  }

  createDatabaseView(table: TableDomain, qb: Knex.QueryBuilder): string[] {
    const viewName = this.generateDatabaseViewName(table.id);
    return [this.knex.raw(`CREATE VIEW ?? AS ${qb.toQuery()}`, [viewName]).toQuery()];
  }

  recreateDatabaseView(table: TableDomain, qb: Knex.QueryBuilder): string[] {
    const viewName = this.generateDatabaseViewName(table.id);
    return [
      this.knex.raw(`DROP VIEW IF EXISTS ??`, [viewName]).toQuery(),
      this.knex.raw(`CREATE VIEW ?? AS ${qb.toQuery()}`, [viewName]).toQuery(),
    ];
  }

  dropDatabaseView(tableId: string): string[] {
    const viewName = this.generateDatabaseViewName(tableId);
    return [this.knex.raw(`DROP VIEW IF EXISTS ??`, [viewName]).toQuery()];
  }

  // MySQL doesn't support materialized views
  refreshDatabaseView(_tableId: string): string | undefined {
    return undefined;
  }

  createMaterializedView(table: TableDomain, qb: Knex.QueryBuilder): string {
    // MySQL doesn't support materialized views, create a regular view instead
    const viewName = this.generateDatabaseViewName(table.id);
    return this.knex.raw(`CREATE VIEW ?? AS ${qb.toQuery()}`, [viewName]).toQuery();
  }

  dropMaterializedView(tableId: string): string {
    const viewName = this.generateDatabaseViewName(tableId);
    return this.knex.raw(`DROP VIEW IF EXISTS ??`, [viewName]).toQuery();
  }
}
