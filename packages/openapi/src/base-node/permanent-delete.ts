import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_BASE_NODE_PERMANENT = '/base/{baseId}/node/{nodeId}/permanent';

export const PermanentDeleteBaseNodeRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_NODE_PERMANENT,
  title: 'Permanently delete project node',
  description: 'Permanently delete a node from a project by its ID.',
  request: {
    params: z.object({
      baseId: z.string(),
      nodeId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Permanent deleted node Successfully',
    },
  },
  tags: ['base node'],
});

export const permanentDeleteBaseNode = async (baseId: string, nodeId: string) => {
  return axios.delete(urlBuilder(DELETE_BASE_NODE_PERMANENT, { baseId, nodeId }));
};
