import { BaseQueryColumnType } from '@teable/openapi';
import type { IQueryAggregation, IBaseQuerySelect } from '@teable/openapi';
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
    }
  ): { queryBuilder: Knex.QueryBuilder; fieldMap: Record<string, IFieldInstance> } {
    const { queryBuilder, fieldMap } = content;
    const currentFieldMap = cloneDeep(fieldMap);
    const aggregationColumn =
      content.aggregation?.map((v) => `${v.column}_${v.statisticFunc}`) || [];
    const aliasSelect = select
      ? select.reduce(
          (acc, cur) => {
            const field = currentFieldMap[cur.column];
            if (field && getQueryColumnTypeByFieldInstance(field) === BaseQueryColumnType.Field) {
              if (cur.alias) {
                acc[cur.alias] = field.dbFieldName;
                currentFieldMap[cur.column].dbFieldName = cur.alias;
              } else {
                const alias = `${field.id}_${field.name}`;
                acc[alias] = field.dbFieldName;
                currentFieldMap[cur.column].dbFieldName = alias;
              }
            } else if (field && !aggregationColumn.includes(cur.column)) {
              // filter aggregation column, because aggregation column has selected when parse aggregation
              queryBuilder.select(cur.column);
            }
            return acc;
          },
          {} as Record<string, string>
        )
      : Object.values(currentFieldMap).reduce(
          (acc, cur) => {
            if (getQueryColumnTypeByFieldInstance(cur) === BaseQueryColumnType.Field) {
              const alias = `${cur.id}_${cur.name}`;
              acc[alias] = cur.dbFieldName;
              currentFieldMap[cur.id].dbFieldName = alias;
            }
            return acc;
          },
          {} as Record<string, string>
        );

    !isEmpty(aliasSelect) && queryBuilder.select(aliasSelect);
    // delete not selected field from fieldMap
    // tips: The current query has an aggregation and cannot be deleted. ( select * count(fld) as fld_count from xxxxx) => fld_count cannot be deleted
    if (select) {
      Object.keys(currentFieldMap).forEach((key) => {
        if (!select.find((s) => s.column === key) && !aggregationColumn.includes(key)) {
          delete currentFieldMap[key];
        }
      });
    }
    return { queryBuilder, fieldMap: currentFieldMap };
  }
}
