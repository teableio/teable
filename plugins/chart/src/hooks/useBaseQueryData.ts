import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpErrorCode, type CellFormat, type HttpError } from '@teable/core';
import type { IBaseQueryVo } from '@teable/openapi';
import { BASE_QUERY, urlBuilder } from '@teable/openapi';
import { useContext } from 'react';
import { fetchGetToken } from '../api';
import { ChartContext } from '../components/ChartProvider';
import { useEnv } from './useEnv';

let accessToken: string = '';

export const useBaseQueryData = (cellFormat?: CellFormat) => {
  const { baseId, pluginId } = useEnv();
  const { storage, onQueryError } = useContext(ChartContext);
  const queryClient = useQueryClient();
  const query = storage?.query;

  const { data } = useQuery({
    queryKey: ['baseQuery', baseId, query, cellFormat] as const,
    enabled: !!query || Boolean(pluginId),
    queryFn: async ({ queryKey }) => {
      const url = urlBuilder(BASE_QUERY, { baseId: queryKey[1] });
      const params = new URLSearchParams({
        query: JSON.stringify(queryKey[2]),
      });
      const cellFormat = queryKey[3];
      if (cellFormat) {
        params.append('cellFormat', cellFormat);
      }

      if (!accessToken) {
        const res = await fetchGetToken({
          pluginId,
          baseId,
        });
        accessToken = res.accessToken;
      }

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
        if (res.status === 401) {
          await fetchGetToken({
            pluginId,
            baseId,
          }).then((res) => {
            accessToken = res.accessToken;
            return accessToken;
          });
          return fetch(`/api${url}?${params.toString()}`, {
            method: 'GET',
            credentials: 'omit',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
          }).then((res) => res.json() as Promise<IBaseQueryVo>);
        }
        onQueryError?.(error.message);
        return {
          rows: [],
          columns: [],
        } as IBaseQueryVo;
      }

      return res.json() as Promise<IBaseQueryVo>;
    },
    useErrorBoundary(error: HttpError) {
      if (error.code === HttpErrorCode.UNAUTHORIZED) {
        fetchGetToken({
          pluginId,
          baseId,
        }).then((res) => {
          accessToken = res.accessToken;
          queryClient.refetchQueries(['baseQuery', baseId, query, cellFormat]);
        });
        return false;
      }
      onQueryError?.(error.message);
      return false;
    },
  });

  return data;
};
