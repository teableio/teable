import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_COMMENT_COUNT = '/comment/{tableId}/count';

export const MAX_COMMENT_COUNT_RECORDS = 1000;

export const getCommentCountRoSchema = z
  .object({
    recordIds: z.array(z.string().startsWith(IdPrefix.Record)).max(MAX_COMMENT_COUNT_RECORDS),
  })
  .strict();

export type IGetCommentCountRo = z.infer<typeof getCommentCountRoSchema>;

export const commentCountVoSchema = z
  .object({
    recordId: z.string(),
    count: z.number(),
  })
  .array();

export type ICommentCountVo = z.infer<typeof commentCountVoSchema>;

export const GetCommentCountRoute: RouteConfig = registerRoute({
  method: 'post',
  path: GET_COMMENT_COUNT,
  description: 'Get comment counts for loaded records',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: getCommentCountRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns the comment counts for the requested records',
      content: {
        'application/json': {
          schema: commentCountVoSchema,
        },
      },
    },
  },
  tags: ['comment'],
});

export const getCommentCount = async (tableId: string, body: IGetCommentCountRo) => {
  return axios.post<ICommentCountVo>(urlBuilder(GET_COMMENT_COUNT, { tableId }), body);
};
