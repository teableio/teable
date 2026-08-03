import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_COMMENT = '/comment/{tableId}/{recordId}/{commentId}';

export const DeleteCommentRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_COMMENT,
  description: 'delete record comment',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      commentId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully delete comment.',
    },
  },
  tags: ['comment'],
});

export const deleteComment = async (tableId: string, recordId: string, commentId: string) => {
  return axios.delete<void>(urlBuilder(DELETE_COMMENT, { tableId, recordId, commentId }));
};
