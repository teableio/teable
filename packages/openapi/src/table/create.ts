import type { ICreateTableRo, ITableFullVo } from '@teable-group/core';
import { tableRoSchema, tableFullVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const CREATE_TABLE = '/base/{baseId}/table/';

export const CreateTableRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_TABLE,
  description: 'Create a table',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: tableRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns data about a table.',
      content: {
        'application/json': {
          schema: tableFullVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const createTable = async (baseId: string, tableRo: ICreateTableRo = {}) => {
  return axios.post<ITableFullVo>(urlBuilder(CREATE_TABLE, { baseId }), tableRo);
};
