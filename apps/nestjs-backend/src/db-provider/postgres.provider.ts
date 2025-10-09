/* eslint-disable sonarjs/no-duplicate-string */
import { Logger } from '@nestjs/common';
import type {
  IFilter,
  ILookupLinkOptionsVo,
  ILookupOptionsVo,
  ISortItem,
  TableDomain,
  FieldCore,
} from '@teable/core';
import { DriverClient, parseFormulaToSQL, FieldType } from '@teable/core';
import type { PrismaClient } from '@teable/db-main-prisma';
import type { IAggregationField, ISearchIndexByQueryRo, TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { IFieldSelectName } from '../features/record/query-builder/field-select.type';
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

  dropSchema(schemaName: string): string {
    return this.knex.raw(`DROP SCHEMA IF EXISTS ?? CASCADE`, [schemaName]).toQuery();
  }

  generateDbTableName(baseId: string, name: string) {
    return `${baseId}.${name}`;
  }

  getForeignKeysInfo(dbTableName: string) {
    const [schemaName, tableName] = this.splitTableName(dbTableName);
    return this.knex
      .raw(
        `
      SELECT tc.constraint_name,
       kcu.column_name,
       ccu.table_schema AS referenced_table_schema,
       ccu.table_name   AS referenced_table_name,
       ccu.column_name  AS referenced_column_name
FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = ?
  AND tc.table_name = ?;
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
    return this.knex.raw('DROP TABLE IF EXISTS ?? CASCADE', [tableName]).toQuery();
  }

  async checkColumnExist(
    tableName: string,
    columnName: string,
    prisma: PrismaClient
  ): Promise<boolean> {
    const [schemaName, dbTableName] = this.splitTableName(tableName);
    const sql = this.knex
      .raw(
        'SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?) AS exists',
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
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = ? AND table_name = ?) AS exists',
        [schemaName, dbTableName]
      )
      .toQuery();
  }

  renameColumn(tableName: string, oldName: string, newName: string): string[] {
    return this.knex.schema
      .alterTable(tableName, (table) => {
        table.renameColumn(oldName, newName);
      })
      .toSQL()
      .map((item) => item.sql);
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
    const visitor = new DropPostgresDatabaseColumnFieldVisitor(context);
    return fieldInstance.accept(visitor);
  }

  // postgres drop index with column automatically
  dropColumnAndIndex(tableName: string, columnName: string, _indexName: string): string[] {
    // Use CASCADE to automatically drop dependent objects (like generated columns)
    // This is safe because we handle application-level dependencies separately
    return [
      this.knex
        .raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ?? CASCADE', [tableName, columnName])
        .toQuery(),
    ];
  }

  columnInfo(tableName: string): string {
    const [schemaName, dbTableName] = tableName.split('.');
    return this.knex
      .select({
        name: 'column_name',
      })
      .from('information_schema.columns')
      .where({
        table_schema: schemaName,
        table_name: dbTableName,
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
      .where(this.knex.raw(`"${columnName}"->>'id' = ?`, [id]))
      .update({
        [columnName]: this.knex.raw(
          `
        jsonb_set(
          "${columnName}",
          '{${key}}',
          to_jsonb(?::text)
        )
      `,
          [value]
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
          (
            SELECT jsonb_agg(
              CASE
                WHEN elem->>'id' = ?
                THEN jsonb_set(elem, '{${key}}', to_jsonb(?::text))
                ELSE elem
              END
            )
            FROM jsonb_array_elements("${columnName}") AS elem
          )
        `,
          [id, value]
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

    // For Link fields, ensure the host base column exists immediately during modify
    // to guarantee subsequent update-from-select can persist values. Defer FK/junction
    // creation to FieldConvertingLinkService (we mark as symmetric here to skip FK creation).
    if (fieldInstance.type === FieldType.Link && !fieldInstance.isLookup) {
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
          // Create base column only; skip FK/junction here
          isSymmetricField: true,
          skipBaseColumnCreation: false,
        };
        const visitor = new CreatePostgresDatabaseColumnFieldVisitor(createContext);
        fieldInstance.accept(visitor);
      });
      const alterTableQueries = alterTableBuilder.toSQL().map((item) => item.sql);
      queries.push(...alterTableQueries);
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
      const visitor = new CreatePostgresDatabaseColumnFieldVisitor(createContext);
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
    let visitor: CreatePostgresDatabaseColumnFieldVisitor | undefined = undefined;

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
      visitor = new CreatePostgresDatabaseColumnFieldVisitor(context);
      fieldInstance.accept(visitor);
    });

    const mainSqls = alterTableBuilder.toSQL().map((item) => item.sql);
    const additionalSqls =
      (visitor as CreatePostgresDatabaseColumnFieldVisitor | undefined)?.getSql() ?? [];

    return [...mainSqls, ...additionalSqls].filter(Boolean);
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
    return this.knex
      .raw(`CREATE TABLE ??.?? AS TABLE ??.?? ${withData ? '' : 'WITH NO DATA'}`, [
        toSchema,
        dbTableName,
        fromSchema,
        dbTableName,
      ])
      .toQuery();
  }

  alterAutoNumber(tableName: string): string[] {
    const [schema, dbTableName] = this.splitTableName(tableName);
    const seqName = `${schema}_${dbTableName}_seq`;
    return [
      this.knex.raw(`CREATE SEQUENCE ??`, [seqName]).toQuery(),
      this.knex
        .raw(`ALTER TABLE ??.?? ALTER COLUMN __auto_number SET DEFAULT nextval('??')`, [
          schema,
          dbTableName,
          seqName,
        ])
        .toQuery(),
      this.knex
        .raw(`SELECT setval('??', (SELECT MAX(__auto_number) FROM ??.??))`, [
          seqName,
          schema,
          dbTableName,
        ])
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

  updateFromSelectSql(params: {
    dbTableName: string;
    idFieldName: string;
    subQuery: Knex.QueryBuilder;
    dbFieldNames: string[];
    returningDbFieldNames?: string[];
  }): string {
    const { dbTableName, idFieldName, subQuery, dbFieldNames, returningDbFieldNames } = params;
    const alias = '__s';
    const updateColumns = dbFieldNames.reduce<{ [key: string]: unknown }>((acc, name) => {
      acc[name] = this.knex.ref(`${alias}.${name}`);
      return acc;
    }, {});
    // bump version on target table; qualify to avoid ambiguity with FROM subquery columns
    updateColumns['__version'] = this.knex.raw('?? + 1', [`${dbTableName}.__version`]);

    const fromRaw = this.knex.raw('(?) as ??', [subQuery, alias]);
    const returningCols = [idFieldName, '__version', ...(returningDbFieldNames || dbFieldNames)];
    const qualifiedReturning = returningCols.map((c) => this.knex.ref(`${dbTableName}.${c}`));
    // also return previous version for ShareDB op version alignment
    const returningAll = [
      ...qualifiedReturning,
      // Unqualified reference to target table column to avoid FROM-clause issues
      this.knex.raw('?? - 1 as __prev_version', [`${dbTableName}.__version`]),
    ];
    const query = this.knex(dbTableName)
      .update(updateColumns)
      .updateFrom(fromRaw)
      .where(`${dbTableName}.${idFieldName}`, this.knex.ref(`${alias}.${idFieldName}`))
      // Returning is supported on Postgres; qualify to avoid ambiguity with FROM subquery
      .returning(returningAll as unknown as [])
      .toQuery();
    this.logger.debug('updateFromSelectSql: ' + query);
    return query;
  }

  aggregationQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    aggregationFields?: IAggregationField[],
    extra?: IAggregationQueryExtra,
    context?: IRecordQueryAggregateContext
  ): IAggregationQueryInterface {
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
    fields?: { [fieldId: string]: FieldCore },
    filter?: IFilter,
    extra?: IFilterQueryExtra,
    context?: IRecordQueryFilterContext
  ): IFilterQueryInterface {
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
    fieldMap?: { [fieldId: string]: FieldCore },
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
    isMultipleCellValue?: boolean
  ) {
    if (isMultipleCellValue) {
      originQueryBuilder.distinct(
        this.knex.raw(`jsonb_array_elements("${dbFieldName}")->>'id' AS user_id`)
      );
    } else {
      originQueryBuilder.distinct(
        this.knex.raw(`jsonb_extract_path_text("${dbFieldName}", 'id') AS user_id`)
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

    return qb
      .select([
        this.knex.raw('dates.date'),
        this.knex.raw('COUNT(*) as count'),
        this.knex.raw(`(array_agg(?? ORDER BY ??.??))[1:10] as ids`, [
          '__id',
          dbTableName,
          startField.dbFieldName,
        ]),
      ])
      .crossJoin(
        this.knex.raw(
          `(SELECT date::date as date
    FROM generate_series(
      (?::timestamptz AT TIME ZONE ?)::date,
      (?::timestamptz AT TIME ZONE ?)::date,
      '1 day'::interval
    ) AS date) as dates`,
          [startDate, timezone, endDate, timezone]
        )
      )
      .where((builder) => {
        builder
          .where(`${dbTableName}.${startField.dbFieldName}`, '<', endDate)
          .andWhere(
            this.knex.raw(`COALESCE(??.??::timestamptz, ??.??)::timestamptz >= ?::timestamptz`, [
              dbTableName,
              endField.dbFieldName,
              dbTableName,
              startField.dbFieldName,
              startDate,
            ])
          )
          .andWhere((subBuilder) => {
            subBuilder
              .whereRaw(`(??.??::timestamptz AT TIME ZONE ?)::date <= dates.date`, [
                dbTableName,
                startField.dbFieldName,
                timezone,
              ])
              .andWhereRaw(
                `(COALESCE(??.??::timestamptz, ??.??)::timestamptz AT TIME ZONE ?)::date >= dates.date`,
                [dbTableName, endField.dbFieldName, dbTableName, startField.dbFieldName, timezone]
              );
          });
      })
      .groupBy('dates.date')
      .orderBy('dates.date', 'asc');
  }

  // select id and lookup_options for "field" table options is a json saved in string format, match optionsKey and value
  // please use json method in postgres
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
      .whereRaw(`lookup_options::json->>'${optionsKey}' = ?`, [value])
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
      .whereRaw(`options::json->>'${optionsKey}' = ?`, [value])
      .where('type', type)
      .toQuery();
  }

  searchBuilder(qb: Knex.QueryBuilder, search: [string, string][]): Knex.QueryBuilder {
    return qb.where((builder) => {
      search.forEach(([field, value]) => {
        builder.orWhere(field, 'ilike', `%${value}%`);
      });
    });
  }

  getTableIndexes(dbTableName: string): string {
    const [, tableName] = this.splitTableName(dbTableName);
    return this.knex
      .raw(
        `
        SELECT
    i.relname AS name,
    ix.indisunique AS "isUnique",
    CAST(jsonb_agg(a.attname ORDER BY u.attposition) AS TEXT) AS columns
FROM
    pg_class t,
    pg_class i,
    pg_index ix,
    pg_attribute a,
    unnest(ix.indkey) WITH ORDINALITY u(attnum, attposition)
WHERE
    t.oid = ix.indrelid
    AND i.oid = ix.indexrelid
    AND a.attrelid = t.oid
    AND a.attnum = u.attnum
    AND t.relname = ?
GROUP BY
    i.relname,
    ix.indisunique,
    ix.indisprimary
ORDER BY
    i.relname;
      `,
        [tableName]
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
    return new SelectQueryPostgres();
  }

  convertFormulaToSelectQuery(
    expression: string,
    context: ISelectFormulaConversionContext
  ): IFieldSelectName {
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

  createDatabaseView(
    table: TableDomain,
    qb: Knex.QueryBuilder,
    options?: { materialized?: boolean }
  ): string[] {
    const viewName = this.generateDatabaseViewName(table.id);
    if (options?.materialized) {
      // Create MV and add unique index on __id to support concurrent refresh
      const createMv = this.knex
        .raw(`CREATE MATERIALIZED VIEW ?? AS ${qb.toQuery()}`, [viewName])
        .toQuery();
      const createIndex = `CREATE UNIQUE INDEX IF NOT EXISTS ${viewName}__id_uidx ON "${viewName}" ("__id")`;
      return [createMv, createIndex];
    }
    return [this.knex.raw(`CREATE VIEW ?? AS ${qb.toQuery()}`, [viewName]).toQuery()];
  }

  recreateDatabaseView(table: TableDomain, qb: Knex.QueryBuilder): string[] {
    const oldName = this.generateDatabaseViewName(table.id);
    const newName = `${oldName}_new`;
    const stmts: string[] = [];
    // Clean temp and conflicting indexes
    stmts.push(`DROP INDEX IF EXISTS "${newName}__id_uidx"`);
    stmts.push(`DROP INDEX IF EXISTS "${oldName}__id_uidx"`);
    stmts.push(`DROP MATERIALIZED VIEW IF EXISTS "${newName}"`);
    // Create empty MV and index, then initial non-concurrent populate
    stmts.push(`CREATE MATERIALIZED VIEW "${newName}" AS ${qb.toQuery()} WITH NO DATA`);
    stmts.push(`CREATE UNIQUE INDEX "${newName}__id_uidx" ON "${newName}" ("__id")`);
    stmts.push(`REFRESH MATERIALIZED VIEW "${newName}"`);
    // Swap
    stmts.push(`DROP MATERIALIZED VIEW IF EXISTS "${oldName}"`);
    stmts.push(`ALTER MATERIALIZED VIEW "${newName}" RENAME TO "${oldName}"`);
    // Keep index name stable after swap
    stmts.push(`ALTER INDEX "${newName}__id_uidx" RENAME TO "${oldName}__id_uidx"`);
    // Ensure final MV has data (defensive refresh)
    stmts.push(`REFRESH MATERIALIZED VIEW "${oldName}"`);
    return stmts;
  }

  dropDatabaseView(tableId: string): string[] {
    const viewName = this.generateDatabaseViewName(tableId);
    // Try dropping both MV and normal VIEW to be safe
    return [
      this.knex.raw(`DROP MATERIALIZED VIEW IF EXISTS ??`, [viewName]).toQuery(),
      this.knex.raw(`DROP VIEW IF EXISTS ??`, [viewName]).toQuery(),
    ];
  }

  refreshDatabaseView(tableId: string, options?: { concurrently?: boolean }): string {
    const viewName = this.generateDatabaseViewName(tableId);
    this.logger.debug(
      'refreshDatabaseView %s with concurrently %s',
      viewName,
      options?.concurrently
    );
    const concurrently = options?.concurrently ?? true;
    if (concurrently) {
      return `REFRESH MATERIALIZED VIEW CONCURRENTLY "${viewName}"`;
    }
    return `REFRESH MATERIALIZED VIEW "${viewName}"`;
  }

  createMaterializedView(table: TableDomain, qb: Knex.QueryBuilder): string {
    const viewName = this.generateDatabaseViewName(table.id);
    return this.knex.raw(`CREATE MATERIALIZED VIEW ?? AS ${qb.toQuery()}`, [viewName]).toQuery();
  }

  dropMaterializedView(tableId: string): string {
    const viewName = this.generateDatabaseViewName(tableId);
    return this.knex.raw(`DROP MATERIALIZED VIEW IF EXISTS ??`, [viewName]).toQuery();
  }
}
