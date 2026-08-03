import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseNodeVoSchema } from './types';

export const GET_BASE_NODE_LIST = '/base/{baseId}/node/list';

export const baseNodeListVoSchema = z.array(baseNodeVoSchema);

export type IBaseNodeListVo = z.infer<typeof baseNodeListVoSchema>;

export const GetBaseNodeListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_NODE_LIST,
  description: 'Get list nodes of a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'List nodes',
      content: {
        'application/json': {
          schema: baseNodeListVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const getBaseNodeList = async (baseId: string) => {
  return axios.get<IBaseNodeListVo>(urlBuilder(GET_BASE_NODE_LIST, { baseId }));
};
