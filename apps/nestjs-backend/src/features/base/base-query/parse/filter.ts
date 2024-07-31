import { BadRequestException } from '@nestjs/common';
import type { IFilter, IFilterSet } from '@teable/core';
import { type IBaseQueryFilter } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db-provider/db.provider.interface';
import type { IFieldInstance } from '../../../field/model/factory';

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
    const { filter: filterQuery } = this.convertQueryFilterToFilter(filter, fieldMap);

    dbProvider
      .filterQuery(queryBuilder, fieldMap, filterQuery, { withUserId: currentUserId })
      .appendQueryBuilder();
    return {
      queryBuilder,
      fieldMap,
    };
  }

  private convertQueryFilterToFilter(
    filter: IBaseQueryFilter,
    fieldMap: Record<string, IFieldInstance>
  ): {
    filter: IFilter;
  } {
    if (!filter) {
      return { filter: null };
    }
    // convert baseQuery filter to filterQuery filter
    const filterSets: IFilterSet['filterSet'] = [];
    filter.filterSet.forEach((item) => {
      if ('filterSet' in item) {
        const { filter } = this.convertQueryFilterToFilter(item, fieldMap);
        filter && filterSets.push(filter);
      } else {
        const field = fieldMap[item.column];
        if (!field) {
          throw new BadRequestException(`Field ${item.column} not found`);
        }
        filterSets.push({
          isSymbol: false,
          fieldId: item.column,
          operator: item.operator,
          value: item.value,
        });
      }
    });

    return {
      filter: {
        filterSet: filterSets,
        conjunction: filter.conjunction,
      },
    };
  }
}
