import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const DELETE_COMMENT_REACTION = '/comment/{tableId}/{recordId}/{commentId}/reaction';

export const DeleteCommentReactionRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_COMMENT_REACTION,
  description: 'delete record comment reaction',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      commentId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            emoji: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully delete comment reaction.',
    },
  },
  tags: ['comment'],
});

export const deleteCommentReaction = async (
  tableId: string,
  recordId: string,
  commentId: string,
  deleteCommentEmojiRo: { emoji: string }
) => {
  return axios.delete<void>(urlBuilder(DELETE_COMMENT_REACTION, { tableId, recordId, commentId }), {
    data: deleteCommentEmojiRo,
  });
};
