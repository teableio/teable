import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import type { IUpdateCommentReactionRo } from '../types';
import { updateCommentReactionRoSchema } from '../types';

export const CREATE_COMMENT_REACTION = '/comment/{tableId}/{recordId}/{commentId}/reaction';

export const CreateCommentReactionRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_COMMENT_REACTION,
  description: 'create record comment reaction',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      commentId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateCommentReactionRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully create comment reaction.',
    },
  },
  tags: ['comment'],
});

export const createCommentReaction = async (
  tableId: string,
  recordId: string,
  commentId: string,
  createCommentReactionRo: IUpdateCommentReactionRo
) => {
  return axios.patch<void>(
    urlBuilder(CREATE_COMMENT_REACTION, { tableId, recordId, commentId }),
    createCommentReactionRo
  );
};
