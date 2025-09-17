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
import { AggregationQueryPostgres } from './aggregation-query/postgres/aggregation-query.postgres';
import type { BaseQueryAbstract } from './base-query/abstract';
import { BaseQueryPostgres } from './base-query/base-query.postgres';
import type {
  IAggregationQueryExtra,
  ICalendarDailyCollectionQueryProps,
  IDbProvider,
  IFilterQueryExtra,
  ISortQueryExtra,
} from './db.provider.interface';
import { DuplicateAttachmentTableQueryPostgres } from './duplicate-table/duplicate-attachment-table-query.postgres';
import { DuplicateTableQueryPostgres } from './duplicate-table/duplicate-query.postgres';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQueryPostgres } from './filter-query/postgres/filter-query.postgres';
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

  groupQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fieldMap?: { [fieldId: string]: IFieldInstance },
    groupFieldIds?: string[],
    extra?: IGroupQueryExtra
  ): IGroupQueryInterface {
    return new GroupQueryPostgres(this.knex, originQueryBuilder, fieldMap, groupFieldIds, extra);
  }

  searchQuery(
    originQueryBuilder: Knex.QueryBuilder,
    dbTableName: string,
    searchFields: IFieldInstance[],
    tableIndex: TableIndex[],
    search: [string, string?, boolean?]
  ) {
    return SearchQueryAbstract.appendQueryBuilder(
      SearchQueryPostgres,
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
      SearchQueryPostgres,
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
    return new SearchQueryPostgresBuilder(
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
  lookupOptionsQuery(optionsKey: keyof ILookupOptionsVo, value: string): string {
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
}
