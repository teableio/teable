import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_RECORD_COMMENT_COUNT = '/comment/{tableId}/{recordId}/count';

export const recordCommentCountVoSchema = z.object({
  count: z.number(),
});

export type IRecordCommentCountVo = z.infer<typeof recordCommentCountVoSchema>;

export const GetRecordCommentCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORD_COMMENT_COUNT,
  description: 'Get record comment count',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the comment count by query',
      content: {
        'application/json': {
          schema: recordCommentCountVoSchema,
        },
      },
    },
  },
  tags: ['comment'],
});

export const getRecordCommentCount = async (tableId: string, recordId: string) => {
  return axios.get<IRecordCommentCountVo>(
    urlBuilder(GET_RECORD_COMMENT_COUNT, { tableId, recordId })
  );
};
