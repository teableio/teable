import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { updateCommentRoSchema } from './types';
import type { IUpdateCommentRo } from './types';

export const UPDATE_COMMENT = '/comment/{tableId}/{recordId}/{commentId}';

export const UpdateCommentRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_COMMENT,
  description: 'update record comment',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      commentId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateCommentRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update comment.',
    },
  },
  tags: ['comment'],
});

export const updateComment = async (
  tableId: string,
  recordId: string,
  commentId: string,
  updateCommentRo: IUpdateCommentRo
) => {
  return axios.patch<void>(
    urlBuilder(UPDATE_COMMENT, { tableId, recordId, commentId }),
    updateCommentRo
  );
};
