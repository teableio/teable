import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseNodeVoSchema } from './types';
import type { IBaseNodeVo } from './types';

export const GET_BASE_NODE = '/base/{baseId}/node/{nodeId}';

export const GetBaseNodeRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_NODE,
  description: 'Get nodes for a base',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Nodes',
      content: {
        'application/json': {
          schema: baseNodeVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const getBaseNode = async (baseId: string, nodeId: string) => {
  return axios.get<IBaseNodeVo>(urlBuilder(GET_BASE_NODE, { baseId, nodeId }));
};
