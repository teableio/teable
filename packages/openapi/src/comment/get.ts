import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { commentSchema } from './types';
import type { ICommentVo } from './types';

export const GET_COMMENT_DETAIL = '/comment/{tableId}/{recordId}/{commentId}';

export const GetCommentDetailRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_COMMENT_DETAIL,
  description: 'Get record comment detail',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Returns the record's comment detail",
      content: {
        'application/json': {
          schema: z.array(commentSchema),
        },
      },
    },
  },
  tags: ['comment'],
});

export const getCommentDetail = async (tableId: string, recordId: string, commentId: string) => {
  return axios.get<ICommentVo>(urlBuilder(GET_COMMENT_DETAIL, { tableId, recordId, commentId }));
};
