import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_BASE_SHARE = '/base/{baseId}/share/{shareId}';

export const DeleteBaseShareRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_SHARE,
  title: 'Delete project share link',
  description: 'Delete a project share link by its ID.',
  request: {
    params: z.object({
      baseId: z.string(),
      shareId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully deleted',
    },
  },
  tags: ['base-share'],
});

export const deleteBaseShare = (baseId: string, shareId: string) => {
  return axios.delete<void>(urlBuilder(DELETE_BASE_SHARE, { baseId, shareId }));
};
