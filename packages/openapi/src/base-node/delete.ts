import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_BASE_NODE = '/base/{baseId}/node/{nodeId}';

export const deleteBaseNodeVoSchema = z.object({
  resourceId: z.string(),
  resourceType: z.string(),
  permanent: z.boolean().optional(),
});

export type IDeleteBaseNodeVo = z.infer<typeof deleteBaseNodeVoSchema>;

export const DeleteBaseNodeRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_NODE,
  description: 'Delete a node for a base',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted node Successfully',
      content: {
        'application/json': {
          schema: deleteBaseNodeVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const deleteBaseNode = async (baseId: string, nodeId: string) => {
  return axios.delete<IDeleteBaseNodeVo>(urlBuilder(DELETE_BASE_NODE, { baseId, nodeId }));
};
