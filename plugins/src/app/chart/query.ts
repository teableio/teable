import { Me, type CellFormat, type HttpError } from '@teable/core';
import { BASE_QUERY, BaseQueryColumnType, urlBuilder } from '@teable/openapi';
import type {
  IBaseQuery,
  IBaseQueryFilterItem,
  IBaseQueryFilterSet,
  IBaseQueryVo,
} from '@teable/openapi';
import { cloneDeep } from 'lodash';
import { fetchGetToken, GetTokenType } from '../../api';

export const baseQueryKeys = (baseId: string, query: IBaseQuery, cellFormat?: CellFormat) =>
  ['baseQuery', baseId, query, cellFormat] as const;

export const formatRes = (res?: IBaseQueryVo): IBaseQueryVo => {
  if (!res) {
    return {
      rows: [],
      columns: [],
    };
  }
  const { columns, rows } = res;
  // recharts does not support column name with space
  const formatColumn = (column: string) => column.replaceAll(' ', '_');
  return {
    columns: columns.map((column) => ({
      ...column,
      column: formatColumn(column.column),
    })),
    rows: rows.map((row) => {
      const newRow: Record<string, unknown> = {};
      columns.forEach((column) => {
        newRow[formatColumn(column.column)] = row[column.column];
      });
      return newRow;
    }),
  };
};

export const getBaseQueryData = async ({
  pluginId,
  queryKeys,
  onQueryError,
  options,
}: {
  pluginId: string;
  queryKeys: ReturnType<typeof baseQueryKeys>;
  onQueryError?: (error: string | undefined) => void;
  options?: {
    currentUserId?: string;
  };
}) => {
  onQueryError?.(undefined);
  const [, baseId, query, cellFormat] = queryKeys;
  const url = urlBuilder(BASE_QUERY, { baseId });
  const queryString = JSON.stringify(
    options?.currentUserId ? replaceQueryMe(query, options.currentUserId) : query
  );

  const params = new URLSearchParams({
    query: queryString,
  });
  if (cellFormat) {
    params.append('cellFormat', cellFormat);
  }

  const { accessToken } = await fetchGetToken({
    pluginId,
    baseId,
    type: GetTokenType.chart,
  });

  const res = await fetch(`/api${url}?${params.toString()}`, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status < 200 || res.status > 300) {
    const error: HttpError = await res.json();
    onQueryError?.(error.message);
    return {
      rows: [],
      columns: [],
    } as IBaseQueryVo;
  }

  return res.json().then((res) => formatRes(res));
};

const replaceFilterMe = (
  filter: IBaseQueryFilterSet,
  currentUserId: string
): IBaseQueryFilterSet => {
  const traverse = (filterItem: IBaseQueryFilterItem | IBaseQueryFilterSet) => {
    if (filterItem && 'column' in filterItem && filterItem.value) {
      if (filterItem.type === BaseQueryColumnType.Aggregation) {
        return;
      }
      if (typeof filterItem.value === 'string' && filterItem.value === Me) {
        filterItem.value = currentUserId;
      } else if (Array.isArray(filterItem.value)) {
        filterItem.value = filterItem.value.map((value) => {
          if (typeof value === 'string' && value === Me) {
            return currentUserId;
          }
          return value;
        }) as IBaseQueryFilterItem['value'];
      }
    } else if (filterItem && 'filterSet' in filterItem) {
      // Recursively traverse nested filterSet
      filterItem.filterSet.forEach((item) => traverse(item));
    }
  };

  const transformedFilter = cloneDeep(filter);

  traverse(transformedFilter);

  return transformedFilter;
};

const replaceQueryMe = (query: IBaseQuery, currentUserId: string) => {
  const traverse = (query: IBaseQuery) => {
    if (typeof query.from === 'string') {
      query.where = query.where ? replaceFilterMe(query.where, currentUserId) : query.where;
    } else {
      traverse(query.from);
    }
  };

  const transformedQuery = cloneDeep(query);

  traverse(transformedQuery);

  return transformedQuery;
};
