/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseQueryColumnType } from '@teable/openapi';
import type { IQueryAggregation, IBaseQuerySelect, IBaseQueryGroupBy } from '@teable/openapi';
import type { Knex } from 'knex';
import { cloneDeep, isEmpty } from 'lodash';
import type { IDbProvider } from '../../../../db-provider/db.provider.interface';
import { isUserOrLink } from '../../../../utils/is-user-or-link';
import type { IFieldInstance } from '../../../field/model/factory';
import { getQueryColumnTypeByFieldInstance } from './utils';

export class QuerySelect {
  parse(
    select: IBaseQuerySelect[] | undefined,
    content: {
      knex: Knex;
      queryBuilder: Knex.QueryBuilder;
      fieldMap: Record<string, IFieldInstance>;
      aggregation: IQueryAggregation | undefined;
      groupBy: IBaseQueryGroupBy | undefined;
      dbProvider: IDbProvider;
    }
  ): { queryBuilder: Knex.QueryBuilder; fieldMap: Record<string, IFieldInstance> } {
    const { queryBuilder, fieldMap, groupBy, aggregation, knex, dbProvider } = content;
    let currentFieldMap = cloneDeep(fieldMap);

    // column must appear in the GROUP BY clause or be used in an aggregate function
    const groupFieldMap = this.selectGroup(queryBuilder, {
      knex,
      groupBy,
      fieldMap: currentFieldMap,
      dbProvider,
    });
    const allowSelectColumnIds = this.allowSelectedColumnIds(currentFieldMap, groupBy, aggregation);
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
    if (select) {
      select.forEach((cur) => {
        const field = currentFieldMap[cur.column];
        if (field && getQueryColumnTypeByFieldInstance(field) === BaseQueryColumnType.Field) {
          const alias = (cur.alias ? cur.alias : field.id).replace(/\?/g, '_');
          // Use raw to avoid knex double-quoting an already quoted identifier
          queryBuilder.select(knex.raw(`${field.dbFieldName} as ??`, [alias]));
          currentFieldMap[cur.column].name = alias;
          currentFieldMap[cur.column].dbFieldName = alias;
        } else if (field && !aggregationColumn.includes(cur.column)) {
          // filter aggregation column, because aggregation column has selected when parse aggregation
          // quote alias to preserve case for aggregated columns coming from subqueries
          queryBuilder.select(knex.raw('??', [cur.column]));
        } else if (field) {
          // aggregation field id as alias
          currentFieldMap[cur.column].dbFieldName = cur.column;
        }
      });
    } else {
      Object.values(currentFieldMap).forEach((cur) => {
        if (getQueryColumnTypeByFieldInstance(cur) === BaseQueryColumnType.Field) {
          const alias = cur.id;
          queryBuilder.select(knex.raw(`${cur.dbFieldName} as ??`, [alias]));
          currentFieldMap[cur.id].dbFieldName = alias;
        } else {
          // aggregation field id as alias
          currentFieldMap[cur.id].dbFieldName = cur.id;
          !aggregationColumn.includes(cur.id) && queryBuilder.select(knex.raw('??', [cur.id]));
        }
      });
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
    return {
      queryBuilder,
      fieldMap: {
        ...currentFieldMap,
        ...groupFieldMap,
      },
    };
  }

  allowSelectedColumnIds(
    fieldMap: Record<string, IFieldInstance>,
    groupBy: IBaseQueryGroupBy | undefined,
    aggregation: IQueryAggregation | undefined
  ) {
    if (!aggregation && !groupBy) {
      return Object.keys(fieldMap);
    }
    return aggregation?.map((v) => `${v.column}_${v.statisticFunc}`) || [];
  }

  private extractGroupByColumnMap(
    queryBuilder: Knex.QueryBuilder,
    fieldMap: Record<string, IFieldInstance>
  ): Record<string, any> {
    const groupByStatements = (queryBuilder as any)._statements.filter(
      (statement: any) => statement.grouping === 'group'
    );

    // get the outermost GROUP BY columns
    const currentGroupByColumns = groupByStatements.flatMap((statement: any) => statement.value);
    const fieldIdDbFieldNamesMap = Object.values(fieldMap).reduce(
      (acc, cur) => {
        acc[cur.dbFieldName] = cur.id;
        return acc;
      },
      {} as Record<string, string>
    );
    const fieldDbFieldNames = Object.keys(fieldIdDbFieldNamesMap);
    // Also build a map from field id to dbFieldName for easier matching when GROUP BY uses aliases
    const fieldIdToDbFieldNameMap = Object.values(fieldMap).reduce(
      (acc, cur) => {
        acc[cur.id] = cur.dbFieldName;
        return acc;
      },
      {} as Record<string, string>
    );
    return currentGroupByColumns.reduce(
      (acc: Record<string, any>, column: any) => {
        let matchedFieldId: string | undefined;

        if (typeof column === 'string') {
          // Case 1: GROUP BY uses a plain alias/id (e.g., aggregation alias like fldX_sum)
          if (fieldIdToDbFieldNameMap[column]) {
            matchedFieldId = column;
          } else {
            // Case 2: GROUP BY uses the full qualified dbFieldName
            const dbFieldName = fieldDbFieldNames.find((name) => column === name);
            if (dbFieldName) {
              matchedFieldId = fieldIdDbFieldNamesMap[dbFieldName];
            }
          }
        } else {
          // knex may store complex refs as objects; try matching by dbFieldName occurrence
          const dbFieldName = fieldDbFieldNames.find(
            (name) => column.sql?.includes(name) || column.bindings?.includes(name)
          );
          if (dbFieldName) {
            matchedFieldId = fieldIdDbFieldNamesMap[dbFieldName];
          }
        }

        if (matchedFieldId) {
          acc[matchedFieldId] = column;
        }
        return acc;
      },
      {} as Record<string, any>
    );
  }

  selectGroup(
    queryBuilder: Knex.QueryBuilder,
    content: {
      groupBy: IBaseQueryGroupBy | undefined;
      fieldMap: Record<string, IFieldInstance>;
      knex: Knex;
      dbProvider: IDbProvider;
    }
  ): Record<string, IFieldInstance> | undefined {
    const { groupBy, fieldMap, knex, dbProvider } = content;
    if (!groupBy) {
      return;
    }
    const groupFieldMap = Object.values(fieldMap).reduce(
      (acc, field) => {
        if (groupBy?.map((v) => v.column).includes(field.id)) {
          acc[field.id] = field;
        }
        return acc;
      },
      {} as Record<string, IFieldInstance>
    );
    const groupByColumnMap = this.extractGroupByColumnMap(queryBuilder, groupFieldMap);
    Object.entries(groupByColumnMap).forEach(([fieldId, column]) => {
      if (isUserOrLink(fieldMap[fieldId].type)) {
        dbProvider.baseQuery().jsonSelect(queryBuilder, fieldMap[fieldId].dbFieldName, fieldId);
        return;
      }
      queryBuilder.select(
        typeof column === 'string'
          ? knex.raw(`${column} as ??`, [fieldId])
          : knex.raw(`${column.sql} as ??`, [
              ...(Array.isArray((column as any).bindings) ? (column as any).bindings : []),
              fieldId,
            ])
      );
    });

    // Ensure aggregation aliases used in GROUP BY are also selected even if not detected above
    if (groupBy && groupBy.length) {
      const aggregationIds = groupBy
        .filter((v) => v.type === BaseQueryColumnType.Aggregation)
        .map((v) => v.column);
      aggregationIds.forEach((id) => {
        if (!groupByColumnMap[id]) {
          queryBuilder.select(knex.raw('?? as ??', [id, id]));
        }
      });
    }

    const res = cloneDeep(groupFieldMap);
    Object.values(res).forEach((field) => {
      field.dbFieldName = field.id;
    });
    return res;
  }
}
