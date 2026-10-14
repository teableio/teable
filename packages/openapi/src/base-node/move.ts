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
  /**
   * Move the node (and, for folders, its whole subtree) into another project of
   * the same space. When set, parentId/anchorId are resolved against the target
   * project; omitting both places the node at the target root.
   */
  targetBaseId: z.string().optional(),
  /**
   * Extra nodes of the source project to move in the same operation, so a
   * resource and the things it is connected to arrive together. Only
   * meaningful alongside targetBaseId; each lands at the same destination as
   * the node being moved.
   */
  additionalNodeIds: z.array(z.string()).optional(),
});

export type IMoveBaseNodeRo = z.infer<typeof moveBaseNodeRoSchema>;

export const MoveBaseNodeRoute: RouteConfig = registerRoute({
  method: 'put',
  path: MOVE_BASE_NODE,
  title: 'Move project node',
  description:
    'Move or reorder a node within a project hierarchy, or move it into another project of the same space via targetBaseId.',
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
