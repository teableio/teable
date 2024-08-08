import { BaseQueryColumnType, type IQueryAggregation } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { IFieldInstance } from '../../../field/model/factory';
import { createBaseQueryFieldInstance } from './utils';

export class QueryAggregation {
  parse(
    aggregation: IQueryAggregation | undefined,
    content: {
      dbTableName: string;
      dbProvider: IDbProvider;
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
    }
  ): {
    queryBuilder: Knex.QueryBuilder;
    fieldMap: Record<string, IFieldInstance>;
  } {
    if (!aggregation) {
      return { queryBuilder: content.queryBuilder, fieldMap: content.fieldMap };
    }
    const { queryBuilder, dbTableName, fieldMap, dbProvider } = content;
    const notFieldMap: Record<string, IFieldInstance> = {};

    aggregation.forEach((item) => {
      notFieldMap[`${item.column}_${item.statisticFunc}`] = createBaseQueryFieldInstance(
        BaseQueryColumnType.Aggregation,
        {
          id: `${item.column}_${item.statisticFunc}`,
          name: `${fieldMap[item.column].name}.${item.statisticFunc}`,
          dbFieldName: fieldMap[item.column].dbFieldName,
        }
      );
    });

    const fieldInstanceMap = { ...fieldMap, ...notFieldMap };
    dbProvider
      .aggregationQuery(
        queryBuilder,
        dbTableName,
        fieldInstanceMap,
        aggregation.map((v) => ({
          fieldId: v.column,
          statisticFunc: v.statisticFunc,
        }))
      )
      .appendBuilder();
    return {
      queryBuilder,
      fieldMap: fieldInstanceMap,
    };
  }
}
