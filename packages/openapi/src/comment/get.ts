import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { commentReactionDetailSchema } from './reaction';
import { commentContentSchema } from './types';

export const GET_COMMENT_DETAIL = '/comment/{tableId}/{recordId}/{commentId}';

export const commentSchema = z.object({
  id: z.string(),
  content: commentContentSchema,
  createdBy: z.object({
    id: z.string(),
    name: z.string(),
    avatar: z.string().optional(),
  }),
  reaction: commentReactionDetailSchema.optional().nullable(),
  createdTime: z.string(),
  lastModifiedTime: z.string().optional(),
  quoteId: z.string().optional(),
  deletedTime: z.string().optional(),
});

export type ICommentVo = z.infer<typeof commentSchema>;

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
          schema: commentSchema.array(),
        },
      },
    },
  },
  tags: ['comment'],
});

export const getCommentDetail = async (tableId: string, recordId: string, commentId: string) => {
  return axios.get<ICommentVo | null>(
    urlBuilder(GET_COMMENT_DETAIL, { tableId, recordId, commentId })
  );
};
