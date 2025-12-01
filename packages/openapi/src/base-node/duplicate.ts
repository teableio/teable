import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { duplicateDashboardRoSchema } from '../dashboard';
import { duplicateTableRoSchema } from '../table';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseNodeVoSchema, type IBaseNodeVo } from './types';

export const DUPLICATE_BASE_NODE = '/base/{baseId}/node/{nodeId}/duplicate';

// workflow and app use the same schema
export const duplicateNodeRoSchema = z.object({
  name: z.string().trim().optional(),
});

export const duplicateBaseNodeRoSchema = z.union([
  duplicateTableRoSchema,
  duplicateNodeRoSchema,
  duplicateDashboardRoSchema,
]);

export type IDuplicateBaseNodeRo = z.infer<typeof duplicateBaseNodeRoSchema>;

export const DuplicateBaseNodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_BASE_NODE,
  description: 'Duplicate a node for a base',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: duplicateBaseNodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Duplicated node',
      content: {
        'application/json': {
          schema: baseNodeVoSchema,
        },
      },
    },
  },
  tags: ['base node'],
});

export const duplicateBaseNode = async (
  baseId: string,
  nodeId: string,
  ro: IDuplicateBaseNodeRo
) => {
  return axios.post<IBaseNodeVo>(urlBuilder(DUPLICATE_BASE_NODE, { baseId, nodeId }), ro);
};
