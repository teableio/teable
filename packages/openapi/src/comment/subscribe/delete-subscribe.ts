import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const DELETE_COMMENT_SUBSCRIBE = '/comment/{tableId}/{recordId}/subscribe';

export const DeleteCommentSubscribeRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_COMMENT_SUBSCRIBE,
  description: 'unsubscribe record comment',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully subscribe record comment.',
    },
  },
  tags: ['comment'],
});

export const deleteCommentSubscribe = async (tableId: string, recordId: string) => {
  return axios.delete<void>(urlBuilder(DELETE_COMMENT_SUBSCRIBE, { tableId, recordId }));
};
