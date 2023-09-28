import { Logger } from '@nestjs/common';
import { Relationship } from '@teable-group/core';
import type { Knex } from 'knex';
import { map } from 'lodash';
import type { IOpsData } from '../features/calculation/batch.service';
import type { ITopoLinkOrder } from '../features/calculation/reference.service';
import type { IFieldInstance } from '../features/field/model/factory';
import type { IDbProvider } from './interface/db.provider.interface';

export class PostgresProvider implements IDbProvider {
  private readonly logger = new Logger(PostgresProvider.name);
  constructor(private readonly knex: Knex) {}

  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string {
    return this.knex.insert(insertData).into(tableName).toQuery();
  }

  affectedRecordItemsQuerySql(
    topoOrder: ITopoLinkOrder[],
    originRecordIdItems: { dbTableName: string; id: string }[]
  ): string {
    // Initialize the base case for the recursive CTE
    const initTableName = topoOrder[0].linkedTable;
    const initQuery = this.knex
      .select({
        __id: '__id',
        dbTableName: this.knex.raw('?', initTableName),
        selectIn: this.knex.raw('?', null),
        relationTo: this.knex.raw('?::varchar', null),
        fieldId: this.knex.raw('?', null),
      })
      .from(initTableName)
      .whereIn('__id', map(originRecordIdItems, 'id'));

    let finalQuery = this.knex.queryBuilder();
    // Iterate over the nodes in topological order
    for (let i = 0; i < topoOrder.length; i++) {
      const currentOrder = topoOrder[i];
      const { fieldId, foreignKeyField, dbTableName, linkedTable } = currentOrder;
      const affectedRecordsTable = `affected_records_${i}`;

      // Append the current node to the recursive CTE
      if (currentOrder.relationship === Relationship.OneMany) {
        const oneManyQuery = this.knex
          .select({
            __id: this.knex.ref(`${linkedTable}.${foreignKeyField}`),
            dbTableName: this.knex.raw('?', dbTableName),
            selectIn: this.knex.raw('?', `${linkedTable}.${foreignKeyField}`),
            relationTo: this.knex.raw('?', null),
            fieldId: this.knex.raw('?', fieldId),
          })
          .from(linkedTable)
          .join(affectedRecordsTable, `${linkedTable}.__id`, '=', `${affectedRecordsTable}.__id`)
          .where(`${affectedRecordsTable}.dbTableName`, linkedTable);

        const recursiveQuery =
          i < 1 ? initQuery : this.knex.select('*').from(`affected_records_${i - 1}`);

        finalQuery = finalQuery.withRecursive(
          affectedRecordsTable,
          recursiveQuery.union(oneManyQuery)
        );
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

        const recursiveQuery =
          i < 1 ? initQuery : this.knex.select('*').from(`affected_records_${i - 1}`);

        finalQuery = finalQuery.withRecursive(
          affectedRecordsTable,
          recursiveQuery.union(manyOneQuery)
        );
      }
    }

    // Construct the final query using the recursive CTE
    finalQuery = finalQuery.select('*').from(`affected_records_${topoOrder.length - 1}`);

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
  }): { insertTempTableSql: string; updateRecordSql: string } {
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
    const insertTempTableSql = this.knex.insert(insertRowsData).into(tempTableName).toQuery();

    // 3.update data
    const updateColumns = columnNames.reduce<{ [key: string]: unknown }>((pre, columnName) => {
      pre[columnName] = this.knex.ref(`${tempTableName}.${columnName}`);
      return pre;
    }, {});
    const updateRecordSql = this.knex(dbTableName)
      .update(updateColumns)
      .updateFrom(tempTableName)
      .where('__id', this.knex.ref(`${tempTableName}.__id`))
      .toQuery();

    return { insertTempTableSql, updateRecordSql };
  }
}
