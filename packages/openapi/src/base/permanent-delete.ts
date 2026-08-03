import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PERMANENT_DELETE_BASE = '/base/{baseId}/permanent';

export const PermanentDeleteBaseRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: PERMANENT_DELETE_BASE,
  description: 'Permanently delete a base by baseId',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Permanently deleted successfully',
    },
  },
  tags: ['base'],
});

export const permanentDeleteBase = async (baseId: string) => {
  return await axios.delete<null>(
    urlBuilder(PERMANENT_DELETE_BASE, {
      baseId,
    })
  );
};
