import type { AxiosResponse } from 'axios';
import { z } from 'zod';
import { axios } from '../axios';

export const queryParamsRoSchema = z.object({
  params: z.record(z.unknown()),
});

export type IQueryParamsRo = z.infer<typeof queryParamsRoSchema>;

export const queryParamsVoSchema = z.object({
  queryId: z.string().openapi({
    example: 'qry_xxxxxxxx',
    description: 'Unique ID for the saved query parameters',
  }),
});

export type IQueryParamsVo = z.infer<typeof queryParamsVoSchema>;

export const SAVE_QUERY_PARAMS_URL = '/query-params';

export async function saveQueryParams(
  queryParamsRo: IQueryParamsRo
): Promise<AxiosResponse<IQueryParamsVo>> {
  return axios.post<IQueryParamsVo>(SAVE_QUERY_PARAMS_URL, queryParamsRo);
}
