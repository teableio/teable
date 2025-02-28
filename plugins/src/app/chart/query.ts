import { Me, type CellFormat, type HttpError } from '@teable/core';
import { BASE_QUERY, urlBuilder } from '@teable/openapi';
import type { IBaseQuery, IBaseQueryVo } from '@teable/openapi';
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
  let queryString = JSON.stringify(query);
  if (options?.currentUserId) {
    queryString = queryString.replaceAll(`"value":"${Me}"`, `"value":"${options.currentUserId}"`);
  }
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
