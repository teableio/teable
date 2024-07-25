import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldVo } from '@teable/core';
import { fieldVoSchema } from '@teable/core';
import type { Axios, AxiosResponse } from 'axios';
import { axios as axiosInstance } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_FIELD = '/table/{tableId}/field/{fieldId}';

export const GetFieldRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD,
  description: 'Get a field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about a field.',
      content: {
        'application/json': {
          schema: fieldVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export async function getField(tableId: string, fieldId: string): Promise<AxiosResponse<IFieldVo>>;
export async function getField(
  axios: Axios,
  tableId: string,
  fieldId: string
): Promise<AxiosResponse<IFieldVo>>;
export async function getField(
  axios: Axios | string,
  tableId: string,
  fieldId?: string
): Promise<AxiosResponse<IFieldVo>> {
  let theAxios: Axios;
  let theTableId: string;
  let theFieldId: string;

  if (typeof axios === 'string') {
    theAxios = axiosInstance;
    theTableId = axios;
    theFieldId = tableId;
  } else {
    theAxios = axios;
    theTableId = tableId;
    theFieldId = fieldId!;
  }

  return theAxios.get<IFieldVo>(
    urlBuilder(GET_FIELD, {
      tableId: theTableId,
      fieldId: theFieldId,
    })
  );
}
