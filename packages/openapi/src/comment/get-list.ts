import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { commentItemSchema } from './types';
import type { ICommentItem as ICommentVo } from './types';

export const GET_COMMENT_LIST = '/comment/{tableId}/{recordId}/list';

export const GetCommentListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_COMMENT_LIST,
  description: 'Get record comment list',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Returns the list of record's comment",
      content: {
        'application/json': {
          schema: z.array(commentItemSchema),
        },
      },
    },
  },
  tags: ['comment'],
});

export const getCommentList = async (tableId: string, recordId: string) => {
  return axios.get<ICommentVo[]>(urlBuilder(GET_COMMENT_LIST, { tableId, recordId }));
};
