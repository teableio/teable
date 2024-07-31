import type { IFilter, IFilterSet } from '@teable/core';
import type { IBaseQueryFilter } from '@teable/openapi';
import { BaseQueryColumnType } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { IFieldInstance } from '../../../field/model/factory';
import { createBaseQueryFieldInstance } from './utils';

export class QueryFilter {
  parse(
    filter: IBaseQueryFilter | undefined,
    content: {
      dbProvider: IDbProvider;
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
      currentUserId: string;
    }
  ): {
    queryBuilder: Knex.QueryBuilder;
    fieldMap: Record<string, IFieldInstance>;
  } {
    if (!filter) {
      return {
        queryBuilder: content.queryBuilder,
        fieldMap: content.fieldMap,
      };
    }
    const { queryBuilder, dbProvider, currentUserId, fieldMap } = content;
    // baseQuery filter to filterQuery filter
    const { filter: filterQuery, fieldMap: fieldMapQuery } =
      this.convertQueryFilterToFilter(filter);

    const resFieldMap = { ...fieldMap, ...fieldMapQuery };
    dbProvider
      .filterQuery(queryBuilder, resFieldMap, filterQuery, { withUserId: currentUserId })
      .appendQueryBuilder();
    return {
      queryBuilder,
      fieldMap: resFieldMap,
    };
  }

  private convertQueryFilterToFilter(filter: IBaseQueryFilter): {
    filter: IFilter;
    fieldMap: Record<string, IFieldInstance>;
  } {
    if (!filter) {
      return { filter: null, fieldMap: {} };
    }
    let resFieldMap: Record<string, IFieldInstance> = {};
    // convert baseQuery filter to filterQuery filter
    const notFieldCollections: { type: BaseQueryColumnType; column: string }[] = [];
    const filterSets: IFilterSet['filterSet'] = [];
    filter.filterSet.forEach((item) => {
      if ('filterSet' in item) {
        const { filter, fieldMap } = this.convertQueryFilterToFilter(item);
        filter && filterSets.push(filter);
        resFieldMap = { ...resFieldMap, ...fieldMap };
      } else {
        if (item.type !== BaseQueryColumnType.Field) {
          notFieldCollections.push({ type: item.type, column: item.column });
        }
        filterSets.push({
          isSymbol: false,
          fieldId: item.column,
          operator: item.operator,
          value: item.value,
        });
      }
    });

    // handle not field collections
    notFieldCollections.forEach((item) => {
      resFieldMap[item.column] = createBaseQueryFieldInstance(item.column, item.type);
    });

    return {
      filter: {
        filterSet: filterSets,
        conjunction: filter.conjunction,
      },
      fieldMap: resFieldMap,
    };
  }
}
