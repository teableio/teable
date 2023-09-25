import { Relationship } from '@teable-group/core';
import type { Knex } from 'knex';
import { map } from 'lodash';
import type { ITopoLinkOrder } from '../features/calculation/reference.service';
import type { IDbProvider } from './interface/db.provider.interface';

export class SqliteProvider implements IDbProvider {
  constructor(private readonly knex: Knex) {}

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
            selectIn: this.knex.raw('?', `${linkedTable}.${foreignKeyField}`),
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
}
