/* eslint-disable sonarjs/no-duplicate-string */
import { Logger } from '@nestjs/common';
import type {
  IFilter,
  ILookupLinkOptionsVo,
  ILookupOptionsVo,
  ISortItem,
  FieldCore,
  TableDomain,
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
import { AggregationQuerySqlite } from './aggregation-query/sqlite/aggregation-query.sqlite';
import type { BaseQueryAbstract } from './base-query/abstract';
import { BaseQuerySqlite } from './base-query/base-query.sqlite';
import type { ICreateDatabaseColumnContext } from './create-database-column-query/create-database-column-field-visitor.interface';
import { CreateSqliteDatabaseColumnFieldVisitor } from './create-database-column-query/create-database-column-field-visitor.sqlite';
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
import { DropSqliteDatabaseColumnFieldVisitor } from './drop-database-column-query/drop-database-column-field-visitor.sqlite';
import { DuplicateAttachmentTableQuerySqlite } from './duplicate-table/duplicate-attachment-table-query.sqlite';
import { DuplicateTableQuerySqlite } from './duplicate-table/duplicate-query.sqlite';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQuerySqlite } from './filter-query/sqlite/filter-query.sqlite';
import { GeneratedColumnQuerySqlite } from './generated-column-query/sqlite/generated-column-query.sqlite';
import type { IGroupQueryExtra, IGroupQueryInterface } from './group-query/group-query.interface';
import { GroupQuerySqlite } from './group-query/group-query.sqlite';
import type { IntegrityQueryAbstract } from './integrity-query/abstract';
import { IntegrityQuerySqlite } from './integrity-query/integrity-query.sqlite';
import { SearchQueryAbstract } from './search-query/abstract';
import { getOffset } from './search-query/get-offset';
import { IndexBuilderSqlite } from './search-query/search-index-builder.sqlite';
import { SearchQuerySqliteBuilder, SearchQuerySqlite } from './search-query/search-query.sqlite';
import { SelectQuerySqlite } from './select-query/sqlite/select-query.sqlite';
import type { ISortQueryInterface } from './sort-query/sort-query.interface';
import { SortQuerySqlite } from './sort-query/sqlite/sort-query.sqlite';

export class SqliteProvider implements IDbProvider {
  private readonly logger = new Logger(SqliteProvider.name);

  constructor(private readonly knex: Knex) {}

  driver = DriverClient.Sqlite;

  createSchema(_schemaName: string) {
    return undefined;
  }

  dropSchema(_schemaName: string) {
    return undefined;
  }

  generateDbTableName(baseId: string, name: string) {
    return `${baseId}_${name}`;
  }

  // make no-sense
  getForeignKeysInfo(_tableName: string): string {
    return this.knex
      .raw(
        'SELECT NULL as constraint_name, NULL as column_name, NULL as referenced_column_name, NULL as referenced_table_schema, NULL as referenced_table_name WHERE 1=0'
      )
      .toQuery();
  }

  renameTableName(oldTableName: string, newTableName: string) {
    return [this.knex.raw('ALTER TABLE ?? RENAME TO ??', [oldTableName, newTableName]).toQuery()];
  }

  dropTable(tableName: string): string {
    return this.knex.raw('DROP TABLE IF EXISTS ??', [tableName]).toQuery();
  }

  async checkColumnExist(
    tableName: string,
    columnName: string,
    prisma: PrismaClient
  ): Promise<boolean> {
    const sql = this.columnInfo(tableName);
    const columns = await prisma.$queryRawUnsafe<{ name: string }[]>(sql);
    return columns.some((column) => column.name === columnName);
  }

  checkTableExist(tableName: string): string {
    return this.knex
      .raw(
        `SELECT EXISTS (
          SELECT 1 FROM sqlite_master 
          WHERE type='table' AND name = ?
        ) as "exists"`,
        [tableName]
      )
      .toQuery();
  }

  renameColumn(tableName: string, oldName: string, newName: string): string[] {
    return [
      this.knex
        .raw('ALTER TABLE ?? RENAME COLUMN ?? TO ??', [tableName, oldName, newName])
        .toQuery(),
    ];
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
        table,
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

      // Use visitor pattern to recreate columns
      const visitor = new CreateSqliteDatabaseColumnFieldVisitor(createContext);
      fieldInstance.accept(visitor);
    });

    const alterTableQueries = alterTableBuilder.toSQL().map((item) => item.sql);
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
    let visitor: CreateSqliteDatabaseColumnFieldVisitor | undefined = undefined;
    const alterTableBuilder = this.knex.schema.alterTable(tableName, (table) => {
      const context: ICreateDatabaseColumnContext = {
        table,
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
      visitor = new CreateSqliteDatabaseColumnFieldVisitor(context);
      fieldInstance.accept(visitor);
    });

    const mainSqls = alterTableBuilder.toSQL().map((item) => item.sql);
    const additionalSqls =
      (visitor as CreateSqliteDatabaseColumnFieldVisitor | undefined)?.getSql() ?? [];

    return [...mainSqls, ...additionalSqls];
  }

  splitTableName(tableName: string): string[] {
    return tableName.split('_');
  }

  joinDbTableName(schemaName: string, dbTableName: string) {
    return `${schemaName}_${dbTableName}`;
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

    // Use visitor pattern to drop columns
    const visitor = new DropSqliteDatabaseColumnFieldVisitor(context);
    return fieldInstance.accept(visitor);
  }

  dropColumnAndIndex(tableName: string, columnName: string, indexName: string): string[] {
    return [
      this.knex.raw(`DROP INDEX IF EXISTS ??`, [indexName]).toQuery(),
      this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [tableName, columnName]).toQuery(),
    ];
  }

  columnInfo(tableName: string): string {
    return this.knex.raw(`PRAGMA table_info(??)`, [tableName]).toQuery();
  }

  updateJsonColumn(
    tableName: string,
    columnName: string,
    id: string,
    key: string,
    value: string
  ): string {
    return this.knex(tableName)
      .where(this.knex.raw(`json_extract(${columnName}, '$.id') = ?`, [id]))
      .update({
        [columnName]: this.knex.raw(
          `
          json_patch(${columnName}, json_object(?, ?))
        `,
          [key, value]
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
    return this.knex(tableName)
      .update({
        [columnName]: this.knex.raw(
          `
          json(
            (
              SELECT json_group_array(
                json(
                  CASE
                    WHEN json_extract(value, '$.id') = ?
                    THEN json_patch(value, json_object(?, ?))
                    ELSE value
                  END
                )
              )
              FROM json_each(${columnName})
            )
          )
        `,
          [id, key, value]
        ),
      })
      .toQuery();
  }

  duplicateTable(
    fromSchema: string,
    toSchema: string,
    tableName: string,
    withData?: boolean
  ): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, dbTableName] = this.splitTableName(tableName);
    return this.knex
      .raw(`CREATE TABLE ?? AS SELECT * FROM ?? ${withData ? '' : 'WHERE 1=0'}`, [
        this.joinDbTableName(toSchema, dbTableName),
        this.joinDbTableName(fromSchema, dbTableName),
      ])
      .toQuery();
  }

  alterAutoNumber(_tableName: string): string[] {
    return [];
  }

  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string {
    // to-do: The code doesn't taste good because knex utilizes the "select-stmt" mode to construct SQL queries for SQLite batchInsert.
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

  updateFromSelectSql(params: {
    dbTableName: string;
    idFieldName: string;
    subQuery: Knex.QueryBuilder;
    dbFieldNames: string[];
    returningDbFieldNames?: string[];
  }): string {
    const { dbTableName, idFieldName, subQuery, dbFieldNames, returningDbFieldNames } = params;
    const subQuerySql = subQuery.toQuery();
    const wrap = (id: string) => this.knex.client.wrapIdentifier(id);
    const setClause = dbFieldNames
      .map(
        (c) =>
          `${wrap(c)} = (SELECT s.${wrap(c)} FROM (${subQuerySql}) AS s WHERE s.${wrap(
            idFieldName
          )} = ${dbTableName}.${wrap(idFieldName)})`
      )
      .join(', ');
    const returning = [idFieldName, '__version', ...(returningDbFieldNames || dbFieldNames)]
      .map((c) => wrap(c))
      .join(', ');
    return `UPDATE ${dbTableName} SET ${setClause} WHERE EXISTS (SELECT 1 FROM (${subQuerySql}) AS s WHERE s.${wrap(
      idFieldName
    )} = ${dbTableName}.${wrap(idFieldName)}) RETURNING ${returning}`;
  }

  aggregationQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    aggregationFields?: IAggregationField[],
    extra?: IAggregationQueryExtra,
    context?: IRecordQueryAggregateContext
  ): IAggregationQueryInterface {
    return new AggregationQuerySqlite(
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
    return new FilterQuerySqlite(originQueryBuilder, fields, filter, extra, this, context);
  }

  sortQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    sortObjs?: ISortItem[],
    extra?: ISortQueryExtra,
    context?: IRecordQuerySortContext
  ): ISortQueryInterface {
    return new SortQuerySqlite(this.knex, originQueryBuilder, fields, sortObjs, extra, context);
  }

  groupQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fieldMap?: { [fieldId: string]: IFieldInstance },
    groupFieldIds?: string[],
    extra?: IGroupQueryExtra,
    context?: IRecordQueryGroupContext
  ): IGroupQueryInterface {
    return new GroupQuerySqlite(
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
      SearchQuerySqlite,
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
      SearchQuerySqlite,
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
    return new SearchQuerySqliteBuilder(
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
    return new IndexBuilderSqlite();
  }

  duplicateTableQuery(queryBuilder: Knex.QueryBuilder) {
    return new DuplicateTableQuerySqlite(queryBuilder);
  }

  duplicateAttachmentTableQuery(queryBuilder: Knex.QueryBuilder) {
    return new DuplicateAttachmentTableQuerySqlite(queryBuilder);
  }

  shareFilterCollaboratorsQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbFieldName: string,
    isMultipleCellValue?: boolean | null
  ) {
    if (isMultipleCellValue) {
      originQueryBuilder
        .distinct(this.knex.raw(`json_extract(json_each.value, '$.id') AS user_id`))
        .crossJoin(this.knex.raw(`json_each(${dbFieldName})`));
    } else {
      originQueryBuilder.distinct(this.knex.raw(`json_extract(${dbFieldName}, '$.id') AS user_id`));
    }
  }

  baseQuery(): BaseQueryAbstract {
    return new BaseQuerySqlite(this.knex);
  }

  integrityQuery(): IntegrityQueryAbstract {
    return new IntegrityQuerySqlite(this.knex);
  }

  calendarDailyCollectionQuery(
    qb: Knex.QueryBuilder,
    props: ICalendarDailyCollectionQueryProps
  ): Knex.QueryBuilder {
    const { startDate, endDate, startField, endField } = props;
    const timezone = startField.options.formatting.timeZone;
    const offsetStr = `${getOffset(timezone)} hour`;

    const datesSubquery = this.knex.raw(
      `WITH RECURSIVE dates(date) AS (
        SELECT date(datetime(?, ?)) as date
        UNION ALL
        SELECT date(datetime(date, ?))
        FROM dates
        WHERE date < date(datetime(?, ?))
      )
      SELECT date FROM dates`,
      [startDate, offsetStr, '+1 day', endDate, offsetStr]
    );

    return qb
      .select([
        this.knex.raw('d.date'),
        this.knex.raw('COUNT(*) as count'),
        this.knex.raw('GROUP_CONCAT(??) as ids', ['__id']),
      ])
      .crossJoin(datesSubquery.wrap('(', ') as d'))
      .where((builder) => {
        builder
          .where(this.knex.raw(`datetime(??, ?)`, [endField.dbFieldName, offsetStr]), '<', endDate)
          .andWhere(
            this.knex.raw(`datetime(COALESCE(??, ??), ?)`, [
              endField.dbFieldName,
              startField.dbFieldName,
              offsetStr,
            ]),
            '>=',
            startDate
          );
      })
      .andWhere((builder) => {
        builder.whereRaw(
          `date(datetime(??, ?)) <= d.date AND date(datetime(COALESCE(??, ??), ?)) >= d.date`,
          [
            startField.dbFieldName,
            offsetStr,
            endField.dbFieldName,
            startField.dbFieldName,
            offsetStr,
          ]
        );
      })
      .groupBy('d.date')
      .orderBy('d.date', 'asc');
  }

  // select id and lookup_options for "field" table options is a json saved in string format, match optionsKey and value
  // please use json method in sqlite
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
      .whereRaw(`json_extract(lookup_options, '$."${optionsKey}"') = ?`, [value])
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
      .where('type', type)
      .whereNull('is_lookup')
      .whereNull('deleted_time')
      .whereRaw(`json_extract(options, '$."${optionsKey}"') = ?`, [value])
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
    return this.knex
      .raw(
        `SELECT
    s.name AS name,
    (SELECT "unique" FROM pragma_index_list(s.tbl_name) WHERE name = s.name) AS isUnique,
    (SELECT json_group_array(name) FROM pragma_index_info(s.name) ORDER BY seqno) AS columns
FROM
    sqlite_schema AS s
WHERE
    s.type = 'index'
    AND s.tbl_name = ?
ORDER BY
    s.name;`,
        [dbTableName]
      )
      .toQuery();
  }

  generatedColumnQuery(): IGeneratedColumnQueryInterface {
    return new GeneratedColumnQuerySqlite();
  }
  convertFormulaToGeneratedColumn(
    expression: string,
    context: IFormulaConversionContext
  ): IFormulaConversionResult {
    try {
      const generatedColumnQuery = this.generatedColumnQuery();
      // Set the context with driver client information
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
    return new SelectQuerySqlite();
  }

  convertFormulaToSelectQuery(
    expression: string,
    context: ISelectFormulaConversionContext
  ): string {
    try {
      const selectQuery = this.selectQuery();
      // Set the context with driver client information
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

  // SQLite views are not materialized; nothing to refresh
  refreshDatabaseView(_tableId: string): string | undefined {
    return undefined;
  }

  createMaterializedView(table: TableDomain, qb: Knex.QueryBuilder): string {
    const viewName = this.generateDatabaseViewName(table.id);
    return this.knex.raw(`CREATE VIEW ?? AS ${qb.toQuery()}`, [viewName]).toQuery();
  }

  dropMaterializedView(tableId: string): string {
    const viewName = this.generateDatabaseViewName(tableId);
    return this.knex.raw(`DROP VIEW IF EXISTS ??`, [viewName]).toQuery();
  }
}
