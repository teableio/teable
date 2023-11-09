import { Logger } from '@nestjs/common';
import type { IFilter } from '@teable-group/core';
import { DriverClient, Relationship } from '@teable-group/core';
import type { Knex } from 'knex';
import { map } from 'lodash';
import type { IOpsData } from '../features/calculation/batch.service';
import type { ITopoLinkOrder } from '../features/calculation/reference.service';
import type { IFieldInstance } from '../features/field/model/factory';
import type { IAggregationFunctionInterface } from './aggregation/aggregation-function.interface';
import { AggregationFunctionSqlite } from './aggregation/aggregation-function.sqlite';
import type { IDbProvider } from './db.provider.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';
import { FilterQuerySqlite } from './filter-query/sqlite/filter-query.sqlite';

export class SqliteProvider implements IDbProvider {
  private readonly logger = new Logger(SqliteProvider.name);

  constructor(private readonly knex: Knex) {}

  driver = DriverClient.Sqlite;

  createSchema(_schemaName: string) {
    return undefined;
  }

  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string {
    // TODO: The code doesn't taste good because knex utilizes the "select-stmt" mode to construct SQL queries for SQLite batchInsert.
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

  affectedRecordItemsQuerySql(
    topoOrder: ITopoLinkOrder[],
    originRecordIdItems: { dbTableName: string; id: string }[]
  ): string {
    // Initialize the base case for the recursive CTE
    const initTableName = topoOrder[0].linkedTable;
    const cteQuery = this.knex
      .select({
        __id: '__id',
        dbTableName: this.knex.raw('?', initTableName),
        selectIn: this.knex.raw('?', null),
        relationTo: this.knex.raw('?', null),
        fieldId: this.knex.raw('?', null),
      })
      .from(initTableName)
      .whereIn('__id', map(originRecordIdItems, 'id'));

    // Iterate over the nodes in topological order
    for (let i = 0; i < topoOrder.length; i++) {
      const currentOrder = topoOrder[i];
      const { fieldId, foreignKeyField, dbTableName, linkedTable } = currentOrder;
      const affectedRecordsTable = `affected_records`;

      // Append the current node to the recursive CTE
      if (currentOrder.relationship === Relationship.OneMany) {
        const oneManyQuery = this.knex
          .select({
            __id: this.knex.ref(`${linkedTable}.${foreignKeyField}`),
            dbTableName: this.knex.raw('?', dbTableName),
            selectIn: this.knex.raw('?', `${linkedTable}#${foreignKeyField}`),
            relationTo: this.knex.raw('?', null),
            fieldId: this.knex.raw('?', fieldId),
          })
          .from(linkedTable)
          .join(affectedRecordsTable, `${linkedTable}.__id`, '=', `${affectedRecordsTable}.__id`)
          .where(`${affectedRecordsTable}.dbTableName`, linkedTable);

        cteQuery.union(oneManyQuery);
      } else {
        const manyOneQuery = this.knex
          .select({
            __id: this.knex.ref(`${dbTableName}.__id`),
            dbTableName: this.knex.raw('?', dbTableName),
            selectIn: this.knex.raw('?', null),
            relationTo: this.knex.ref(`${affectedRecordsTable}.__id`),
            fieldId: this.knex.raw('?', fieldId),
          })
          .from(dbTableName)
          .join(
            affectedRecordsTable,
            `${dbTableName}.${foreignKeyField}`,
            '=',
            `${affectedRecordsTable}.__id`
          )
          .where(`${affectedRecordsTable}.dbTableName`, linkedTable);

        cteQuery.union(manyOneQuery);
      }
    }

    // Construct the final query using the recursive CTE
    const finalQuery = this.knex
      .withRecursive('affected_records', cteQuery)
      .select('*')
      .from(`affected_records`);

    // this.logger.log('affectedRecordItemsSql：%s', finalQuery.toQuery());
    return finalQuery.toQuery();
  }

  executeUpdateRecordsSqlList(params: {
    dbTableName: string;
    fieldMap: { [fieldId: string]: IFieldInstance };
    opsData: IOpsData[];
    tempTableName: string;
    columnNames: string[];
    userId: string;
  }): {
    insertTempTableSql: string;
    updateRecordSql: string;
  } {
    const { dbTableName, fieldMap, opsData, tempTableName, columnNames, userId } = params;

    // 2.initialize temporary table data
    const insertRowsData = opsData.map((data) => {
      return {
        __id: data.recordId,
        __version: data.version + 1,
        __last_modified_time: new Date().toISOString(),
        __last_modified_by: userId,
        ...Object.entries(data.updateParam).reduce<{ [dbFieldName: string]: unknown }>(
          (pre, [fieldId, value]) => {
            const field = fieldMap[fieldId];
            const { dbFieldName } = field;
            pre[dbFieldName] = field.convertCellValue2DBValue(value);
            return pre;
          },
          {}
        ),
      };
    });
    const insertTempTableSql = this.batchInsertSql(tempTableName, insertRowsData);

    // 3.update data
    const updateColumns = columnNames.reduce<{ [key: string]: unknown }>((pre, columnName) => {
      pre[columnName] = this.knex.ref(`${tempTableName}.${columnName}`);
      return pre;
    }, {});
    let updateRecordSql = this.knex(dbTableName).update(updateColumns).toQuery();
    updateRecordSql += ` FROM \`${tempTableName}\` WHERE ${dbTableName}.__id = ${tempTableName}.__id`;

    return { insertTempTableSql, updateRecordSql };
  }

  aggregationFunction(dbTableName: string, field: IFieldInstance): IAggregationFunctionInterface {
    return new AggregationFunctionSqlite(this.knex, dbTableName, field);
  }

  filterQuery(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [p: string]: IFieldInstance },
    filter?: IFilter | null
  ): IFilterQueryInterface {
    return new FilterQuerySqlite(originQueryBuilder, fields, filter);
  }
}
