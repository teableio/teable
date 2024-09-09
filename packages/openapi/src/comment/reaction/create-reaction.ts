import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const CREATE_COMMENT_REACTION = '/comment/{tableId}/{recordId}/{commentId}/reaction';

export const CreateCommentReactionRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_COMMENT_REACTION,
  description: 'create record comment emoji',
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
      description: 'Successfully create comment emoji.',
    },
  },
  tags: ['comment'],
});

export const createCommentReaction = async (
  tableId: string,
  recordId: string,
  commentId: string,
  createCommentEmojiRo: { emoji: string }
) => {
  return axios.patch<void>(
    urlBuilder(CREATE_COMMENT_REACTION, { tableId, recordId, commentId }),
    createCommentEmojiRo
  );
};
