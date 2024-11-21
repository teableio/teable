/* eslint-disable sonarjs/no-duplicate-string */
import { Logger } from '@nestjs/common';
import type { IFilter, ISortItem } from '@teable/core';
import { DriverClient } from '@teable/core';
import type { PrismaClient } from '@teable/db-main-prisma';
import type { IAggregationField } from '@teable/openapi';
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
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQueryPostgres } from './filter-query/postgres/filter-query.postgres';
import type { IGroupQueryExtra, IGroupQueryInterface } from './group-query/group-query.interface';
import { GroupQueryPostgres } from './group-query/group-query.postgres';
import { SearchQueryAbstract } from './search-query/abstract';
import { SearchQueryPostgres } from './search-query/search-query.postgres';
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

  renameTableName(oldTableName: string, newTableName: string) {
    const nameWithoutSchema = this.splitTableName(newTableName)[1];
    return [
      this.knex.raw('ALTER TABLE ?? RENAME TO ??', [oldTableName, nameWithoutSchema]).toQuery(),
    ];
  }

  dropTable(tableName: string): string {
    return this.knex.raw('DROP TABLE ??', [tableName]).toQuery();
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
    fieldMap?: { [fieldId: string]: IFieldInstance },
    search?: [string, string?, boolean?]
  ) {
    return SearchQueryAbstract.factory(SearchQueryPostgres, originQueryBuilder, fieldMap, search);
  }

  searchCountQuery(
    originQueryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    searchValue: string
  ) {
    return SearchQueryAbstract.buildSearchCountQuery(
      SearchQueryPostgres,
      originQueryBuilder,
      searchField,
      searchValue
    );
  }

  searchIndexQuery(
    originQueryBuilder: Knex.QueryBuilder,
    searchField: IFieldInstance[],
    searchValue: string,
    dbTableName: string
  ) {
    return SearchQueryAbstract.buildSearchIndexQuery(
      SearchQueryPostgres,
      originQueryBuilder,
      searchField,
      searchValue,
      dbTableName
    );
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

  calendarDailyCollectionQuery(
    qb: Knex.QueryBuilder,
    props: ICalendarDailyCollectionQueryProps
  ): Knex.QueryBuilder {
    const { startDate, endDate, startField, endField } = props;
    const timezone = startField.options.formatting.timeZone;

    return qb
      .select([
        this.knex.raw('dates.date'),
        this.knex.raw('COUNT(*) as count'),
        this.knex.raw(`(array_agg(?? ORDER BY ??))[1:10] as ids`, ['__id', startField.dbFieldName]),
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
          .where(startField.dbFieldName, '<', endDate)
          .andWhere(
            this.knex.raw(`COALESCE(??::timestamptz, ??)::timestamptz >= ?::timestamptz`, [
              endField.dbFieldName,
              startField.dbFieldName,
              startDate,
            ])
          )
          .andWhere((subBuilder) => {
            subBuilder
              .whereRaw(`(??::timestamptz AT TIME ZONE ?)::date <= dates.date`, [
                startField.dbFieldName,
                timezone,
              ])
              .andWhereRaw(
                `(COALESCE(??::timestamptz, ??)::timestamptz AT TIME ZONE ?)::date >= dates.date`,
                [endField.dbFieldName, startField.dbFieldName, timezone]
              );
          });
      })
      .groupBy('dates.date')
      .orderBy('dates.date', 'asc');
  }
}
