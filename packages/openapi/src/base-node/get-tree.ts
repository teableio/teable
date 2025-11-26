import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseNodeVoSchema } from './types';

export const GET_BASE_NODE_TREE = '/base/{baseId}/node/tree';

export const baseNodeTreeVoSchema = z.object({
  nodes: z.array(baseNodeVoSchema),
  maxFolderDepth: z.number(),
});

export type IBaseNodeTreeVo = z.infer<typeof baseNodeTreeVoSchema>;

export const GetBaseNodeTreeRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_NODE_TREE,
  description: 'Get tree nodes for a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Nodes',
      content: {
        'application/json': {
          schema: baseNodeTreeVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const getBaseNodeTree = async (baseId: string) => {
  return axios.get<IBaseNodeTreeVo>(urlBuilder(GET_BASE_NODE_TREE, { baseId }));
};
