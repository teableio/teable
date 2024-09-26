import { BaseQueryColumnType } from '@teable/openapi';
import type { IQueryAggregation, IBaseQuerySelect, IBaseQueryGroupBy } from '@teable/openapi';
import type { Knex } from 'knex';
import { cloneDeep, isEmpty } from 'lodash';
import type { IFieldInstance } from '../../../field/model/factory';
import { getQueryColumnTypeByFieldInstance } from './utils';

export class QuerySelect {
  parse(
    select: IBaseQuerySelect[] | undefined,
    content: {
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
      aggregation: IQueryAggregation | undefined;
      groupBy: IBaseQueryGroupBy | undefined;
    }
  ): { queryBuilder: Knex.QueryBuilder; fieldMap: Record<string, IFieldInstance> } {
    const { queryBuilder, fieldMap, groupBy, aggregation } = content;
    let currentFieldMap = cloneDeep(fieldMap);
    const allowSelectColumnIds = this.allowSelectedColumnIds(currentFieldMap, groupBy, aggregation);
    // column must appear in the GROUP BY clause or be used in an aggregate function
    if (aggregation?.length || groupBy?.length) {
      currentFieldMap = Object.entries(currentFieldMap).reduce(
        (acc, current) => {
          const [key, value] = current;
          if (allowSelectColumnIds.includes(key)) {
            acc[key] = value;
          }
          return acc;
        },
        {} as Record<string, IFieldInstance>
      );
    }
    const aggregationColumn = aggregation?.map((v) => `${v.column}_${v.statisticFunc}`) || [];
    const aliasSelect = select
      ? select.reduce(
          (acc, cur) => {
            const field = currentFieldMap[cur.column];
            if (field && getQueryColumnTypeByFieldInstance(field) === BaseQueryColumnType.Field) {
              if (cur.alias) {
                // replace ? to _ because of knex queryBuilder cannot use ? as alias
                const alias = cur.alias.replace(/\?/g, '_');
                acc[alias] = field.dbFieldName;
                currentFieldMap[cur.column].name = alias;
                currentFieldMap[cur.column].dbFieldName = alias;
              } else {
                const alias = field.id;
                acc[alias] = field.dbFieldName;
                currentFieldMap[cur.column].dbFieldName = alias;
              }
            } else if (field && !aggregationColumn.includes(cur.column)) {
              // filter aggregation column, because aggregation column has selected when parse aggregation
              queryBuilder.select(cur.column);
            } else if (field) {
              // aggregation field id as alias
              currentFieldMap[cur.column].dbFieldName = cur.column;
            }
            return acc;
          },
          {} as Record<string, string>
        )
      : Object.values(currentFieldMap).reduce(
          (acc, cur) => {
            if (getQueryColumnTypeByFieldInstance(cur) === BaseQueryColumnType.Field) {
              const alias = cur.id;
              acc[alias] = cur.dbFieldName;
              currentFieldMap[cur.id].dbFieldName = alias;
            } else {
              // aggregation field id as alias
              currentFieldMap[cur.id].dbFieldName = cur.id;
              !aggregationColumn.includes(cur.id) && queryBuilder.select(cur.id);
            }
            return acc;
          },
          {} as Record<string, string>
        );
    if (!isEmpty(aliasSelect)) {
      queryBuilder.select(aliasSelect);
    }
    // delete not selected field from fieldMap
    // tips: The current query has an aggregation and cannot be deleted. ( select * count(fld) as fld_count from xxxxx) => fld_count cannot be deleted
    if (select) {
      Object.keys(currentFieldMap).forEach((key) => {
        if (!select.find((s) => s.column === key)) {
          if (aggregationColumn.includes(key)) {
            // aggregation field id as alias
            currentFieldMap[key].dbFieldName = key;
            return;
          }
          delete currentFieldMap[key];
        }
      });
    }
    return { queryBuilder, fieldMap: currentFieldMap };
  }

  allowSelectedColumnIds(
    fieldMap: Record<string, IFieldInstance>,
    groupBy: IBaseQueryGroupBy | undefined,
    aggregation: IQueryAggregation | undefined
  ) {
    if (!aggregation && !groupBy) {
      return Object.keys(fieldMap);
    }
    const groupByColumns = groupBy?.map((v) => v.column) || [];
    const aggregationColumns = aggregation?.map((v) => `${v.column}_${v.statisticFunc}`) || [];
    return [...groupByColumns, ...aggregationColumns];
  }
}
