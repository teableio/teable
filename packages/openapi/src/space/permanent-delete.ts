import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PERMANENT_DELETE_SPACE = '/space/{spaceId}/permanent';

export const PermanentDeleteSpaceRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: PERMANENT_DELETE_SPACE,
  description: 'Permanently delete a space by spaceId',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Permanently deleted successfully',
    },
  },
  tags: ['space'],
});

export const permanentDeleteSpace = async (spaceId: string) => {
  return await axios.delete<null>(
    urlBuilder(PERMANENT_DELETE_SPACE, {
      spaceId,
    })
  );
};
