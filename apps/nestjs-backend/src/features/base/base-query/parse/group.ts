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
      knex: Knex;
    }
  ): {
    queryBuilder: Knex.QueryBuilder;
    fieldMap: Record<string, IFieldInstance>;
  } {
    if (!group) {
      return { queryBuilder: content.queryBuilder, fieldMap: content.fieldMap };
    }
    const { queryBuilder, fieldMap, dbProvider, knex } = content;
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
      // Group by the aggregation column alias, quoted to preserve case
      queryBuilder.groupBy(knex.ref(v.column));
    });
    return {
      queryBuilder,
      fieldMap,
    };
  }
}
