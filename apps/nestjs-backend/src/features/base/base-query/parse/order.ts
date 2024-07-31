import { BaseQueryColumnType, type IBaseQueryOrderBy } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { IFieldInstance } from '../../../field/model/factory';
import { createBaseQueryFieldInstance } from './utils';

export class QueryOrder {
  parse(
    order: IBaseQueryOrderBy | undefined,
    content: {
      dbProvider: IDbProvider;
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
    }
  ): {
    queryBuilder: Knex.QueryBuilder;
    fieldMap: Record<string, IFieldInstance>;
  } {
    const { queryBuilder, fieldMap, dbProvider } = content;
    if (!order) {
      return { queryBuilder, fieldMap };
    }

    const notFieldMap: Record<string, IFieldInstance> = {};
    order.forEach((item) => {
      if (item.type !== BaseQueryColumnType.Field) {
        notFieldMap[item.column] = createBaseQueryFieldInstance(item.column, item.type);
      }
    });

    const resFieldMap = { ...fieldMap, ...notFieldMap };
    dbProvider
      .sortQuery(
        queryBuilder,
        resFieldMap,
        order.map((item) => ({
          fieldId: item.column,
          order: item.order,
        }))
      )
      .appendSortBuilder();
    return { queryBuilder, fieldMap: resFieldMap };
  }
}
