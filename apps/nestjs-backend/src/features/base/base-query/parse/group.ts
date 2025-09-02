import { BaseQueryColumnType, type IBaseQueryGroupBy } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { IFieldInstance } from '../../../field/model/factory';

export class QueryGroup {
  parse(
    group: IBaseQueryGroupBy | undefined,
    content: {
      dbProvider: IDbProvider;
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
    }
  ): {
    queryBuilder: Knex.QueryBuilder;
    fieldMap: Record<string, IFieldInstance>;
  } {
    if (!group) {
      return { queryBuilder: content.queryBuilder, fieldMap: content.fieldMap };
    }
    const { queryBuilder, fieldMap, dbProvider } = content;
    const fieldGroup = group.filter((v) => v.type === BaseQueryColumnType.Field);
    const aggregationGroup = group.filter((v) => v.type === BaseQueryColumnType.Aggregation);
    dbProvider
      .groupQuery(
        queryBuilder,
        fieldMap,
        fieldGroup.map((v) => v.column),
        undefined,
        undefined
      )
      .appendGroupBuilder();
    aggregationGroup.forEach((v) => {
      // Group by the aggregation column alias directly to avoid double quoting qualified paths
      queryBuilder.groupBy(v.column);
    });
    return {
      queryBuilder,
      fieldMap,
    };
  }
}
