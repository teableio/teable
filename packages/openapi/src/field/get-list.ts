import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldVo, IGetFieldsQuery } from '@teable/core';
import { fieldVoSchema, getFieldsQuerySchema } from '@teable/core';
import type { Axios, AxiosResponse } from 'axios';
import { axios as axiosInstance } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_FIELD_LIST = '/table/{tableId}/field';

export const GetFieldListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD_LIST,
  description: 'Get field list by query',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: getFieldsQuerySchema,
  },
  responses: {
    200: {
      description: 'Returns the list of field.',
      content: {
        'application/json': {
          schema: z.array(fieldVoSchema),
        },
      },
    },
  },
  tags: ['field'],
});

export async function getFields(
  tableId: string,
  query?: IGetFieldsQuery
): Promise<AxiosResponse<IFieldVo[]>>;
export async function getFields(
  axios: Axios,
  tableId: string,
  query?: IGetFieldsQuery
): Promise<AxiosResponse<IFieldVo[]>>;
export async function getFields(
  axios: Axios | string,
  tableId?: string | IGetFieldsQuery,
  query?: IGetFieldsQuery
): Promise<AxiosResponse<IFieldVo[]>> {
  let theAxios: Axios;
  let theTableId: string;
  let theQuery: IGetFieldsQuery;

  if (typeof axios === 'string') {
    theAxios = axiosInstance;
    theTableId = axios;
    theQuery = tableId as IGetFieldsQuery;
  } else {
    theAxios = axios;
    theTableId = tableId as string;
    theQuery = query as IGetFieldsQuery;
  }

  return theAxios.get<IFieldVo[]>(urlBuilder(GET_FIELD_LIST, { tableId: theTableId }), {
    params: theQuery,
  });
}
