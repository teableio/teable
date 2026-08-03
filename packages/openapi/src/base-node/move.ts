import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseNodeVoSchema, type IBaseNodeVo } from './types';

export const MOVE_BASE_NODE = '/base/{baseId}/node/{nodeId}/move';

export const moveBaseNodeRoSchema = z.object({
  parentId: z.string().nullable().optional(),
  anchorId: z.string().optional(),
  position: z.enum(['before', 'after']).optional(),
});

export type IMoveBaseNodeRo = z.infer<typeof moveBaseNodeRoSchema>;

export const MoveBaseNodeRoute: RouteConfig = registerRoute({
  method: 'put',
  path: MOVE_BASE_NODE,
  description: 'Move or reorder a node',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: moveBaseNodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated node info',
      content: {
        'application/json': {
          schema: baseNodeVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const moveBaseNode = async (baseId: string, nodeId: string, ro: IMoveBaseNodeRo) => {
  return axios.put<IBaseNodeVo>(urlBuilder(MOVE_BASE_NODE, { baseId, nodeId }), ro);
};
