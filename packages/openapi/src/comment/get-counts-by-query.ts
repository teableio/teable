import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { IGetRecordsRo } from '../record';
import { getRecordsRoSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_COMMENT_COUNT = '/comment/{tableId}/count';

export const commentCountVoSchema = z
  .object({
    recordId: z.string(),
    count: z.number(),
  })
  .array();

export type ICommentCountVo = z.infer<typeof commentCountVoSchema>;

export const GetCommentCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_COMMENT_COUNT,
  description: 'Get record comment counts by query',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: getRecordsRoSchema,
  },
  responses: {
    200: {
      description: 'Returns the comment counts by query',
      content: {
        'application/json': {
          schema: commentCountVoSchema,
        },
      },
    },
  },
  tags: ['comment'],
});

export const getCommentCount = async (tableId: string, query: IGetRecordsRo) => {
  return axios.get<ICommentCountVo>(urlBuilder(GET_COMMENT_COUNT, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query.filter),
      orderBy: JSON.stringify(query.orderBy),
      groupBy: JSON.stringify(query.groupBy),
      collapsedGroupIds: JSON.stringify(query.collapsedGroupIds),
    },
  });
};
