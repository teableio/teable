import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ICommentVo } from './get';
import { createCommentRoSchema } from './types';
import type { ICreateCommentRo } from './types';

export const CREATE_COMMENT = '/comment/{tableId}/{recordId}/create';

export const CreateCommentRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_COMMENT,
  description: 'create record comment',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createCommentRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully create comment.',
    },
  },
  tags: ['comment'],
});

export const createComment = async (
  tableId: string,
  recordId: string,
  createCommentRo: ICreateCommentRo
) => {
  return axios.post<ICommentVo>(urlBuilder(CREATE_COMMENT, { tableId, recordId }), createCommentRo);
};
