import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_SPACE = '/space/{spaceId}';

export const DeleteSpaceRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_SPACE,
  description: 'Delete a space by spaceId',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted successfully',
    },
  },
  tags: ['space'],
});

export const deleteSpace = async (spaceId: string) => {
  return await axios.delete<null>(
    urlBuilder(DELETE_SPACE, {
      spaceId,
    })
  );
};
