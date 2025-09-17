/* eslint-disable sonarjs/no-duplicate-string */
import { Logger } from '@nestjs/common';
import type { FieldType, IFilter, ILookupOptionsVo, ISortItem } from '@teable/core';
import { DriverClient } from '@teable/core';
import type { PrismaClient } from '@teable/db-main-prisma';
import type { IAggregationField, ISearchIndexByQueryRo, TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../features/field/model/factory';
import type { SchemaType } from '../features/field/util';
import type { IAggregationQueryInterface } from './aggregation-query/aggregation-query.interface';
import { AggregationQuerySqlite } from './aggregation-query/sqlite/aggregation-query.sqlite';
import type { BaseQueryAbstract } from './base-query/abstract';
import { BaseQuerySqlite } from './base-query/base-query.sqlite';
import type {
  IAggregationQueryExtra,
  ICalendarDailyCollectionQueryProps,
  IDbProvider,
  IFilterQueryExtra,
  ISortQueryExtra,
} from './db.provider.interface';
import { DuplicateAttachmentTableQuerySqlite } from './duplicate-table/duplicate-attachment-table-query.sqlite';
import { DuplicateTableQuerySqlite } from './duplicate-table/duplicate-query.sqlite';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQuerySqlite } from './filter-query/sqlite/filter-query.sqlite';
import type { IGroupQueryExtra, IGroupQueryInterface } from './group-query/group-query.interface';
import { GroupQuerySqlite } from './group-query/group-query.sqlite';
import type { IntegrityQueryAbstract } from './integrity-query/abstract';
import { IntegrityQuerySqlite } from './integrity-query/integrity-query.sqlite';
import { SearchQueryAbstract } from './search-query/abstract';
import { getOffset } from './search-query/get-offset';
import { IndexBuilderSqlite } from './search-query/search-index-builder.sqlite';
import { SearchQuerySqliteBuilder, SearchQuerySqlite } from './search-query/search-query.sqlite';
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

  modifyColumnSchema(tableName: string, columnName: string, schemaType: SchemaType): string[] {
    return [
      this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [tableName, columnName]).toQuery(),
      this.knex
        .raw(`ALTER TABLE ?? ADD COLUMN ?? ??`, [tableName, columnName, schemaType])
        .toQuery(),
    ];
  }

  splitTableName(tableName: string): string[] {
    return tableName.split('_');
  }

  joinDbTableName(schemaName: string, dbTableName: string) {
    return `${schemaName}_${dbTableName}`;
  }

  dropColumn(tableName: string, columnName: string): string[] {
    return [this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [tableName, columnName]).toQuery()];
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

  aggregationQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    fields?: { [fieldId: string]: IFieldInstance },
    aggregationFields?: IAggregationField[],
    extra?: IAggregationQueryExtra
  ): IAggregationQueryInterface {
    return new AggregationQuerySqlite(
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
    fields?: { [p: string]: IFieldInstance },
    filter?: IFilter,
    extra?: IFilterQueryExtra
  ): IFilterQueryInterface {
    return new FilterQuerySqlite(originQueryBuilder, fields, filter, extra);
  }

  sortQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: IFieldInstance },
    sortObjs?: ISortItem[],
    extra?: ISortQueryExtra
  ): ISortQueryInterface {
    return new SortQuerySqlite(this.knex, originQueryBuilder, fields, sortObjs, extra);
  }

  groupQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fieldMap?: { [fieldId: string]: IFieldInstance },
    groupFieldIds?: string[],
    extra?: IGroupQueryExtra
  ): IGroupQueryInterface {
    return new GroupQuerySqlite(this.knex, originQueryBuilder, fieldMap, groupFieldIds, extra);
  }

  searchQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    searchFields: IFieldInstance[],
    tableIndex: TableIndex[],
    search: [string, string?, boolean?]
  ) {
    return SearchQueryAbstract.appendQueryBuilder(
      SearchQuerySqlite,
      originQueryBuilder,
      dbTableName,
      searchFields,
      tableIndex,
      search
    );
  }

  searchCountQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    searchField: IFieldInstance[],
    search: [string, string?, boolean?],
    tableIndex: TableIndex[]
  ) {
    return SearchQueryAbstract.buildSearchCountQuery(
      SearchQuerySqlite,
      originQueryBuilder,
      dbTableName,
      searchField,
      search,
      tableIndex
    );
  }

  searchIndexQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    searchField: IFieldInstance[],
    searchIndexRo: ISearchIndexByQueryRo,
    tableIndex: TableIndex[],
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
  lookupOptionsQuery(optionsKey: keyof ILookupOptionsVo, value: string): string {
    return this.knex('field')
      .select({
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
}
