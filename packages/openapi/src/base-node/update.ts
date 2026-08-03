import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseNodeVoSchema } from './types';
import type { IBaseNodeVo } from './types';

export const UPDATE_BASE_NODE = '/base/{baseId}/node/{nodeId}';

export const updateBaseNodeRoSchema = z.object({
  name: z.string().trim().min(1).optional(),
  icon: z.string().trim().optional(),
});

export type IUpdateBaseNodeRo = z.infer<typeof updateBaseNodeRoSchema>;

export const UpdateBaseNodeRoute: RouteConfig = registerRoute({
  method: 'put',
  path: UPDATE_BASE_NODE,
  description: 'Update a node for a base',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateBaseNodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated node',
      content: {
        'application/json': {
          schema: baseNodeVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const updateBaseNode = async (baseId: string, nodeId: string, ro: IUpdateBaseNodeRo) => {
  return axios.put<IBaseNodeVo>(urlBuilder(UPDATE_BASE_NODE, { baseId, nodeId }), ro);
};
