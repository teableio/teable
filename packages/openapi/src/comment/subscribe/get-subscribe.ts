import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const GET_COMMENT_SUBSCRIBE = '/comment/{tableId}/{recordId}/subscribe';

export const commentSubscribeVoSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  createdBy: z.string(),
});

export type ICommentSubscribeVo = z.infer<typeof commentSubscribeVoSchema>;

export const GetCommentSubscribeRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_COMMENT_SUBSCRIBE,
  description: 'get record comment subscribe detail',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully get record comment subscribe detail.',
      content: {
        'application/json': {
          schema: commentSubscribeVoSchema.nullable(),
        },
      },
    },
  },
  tags: ['comment'],
});

export const getCommentSubscribe = async (tableId: string, recordId: string) => {
  return axios.get<ICommentSubscribeVo | null>(
    urlBuilder(GET_COMMENT_SUBSCRIBE, { tableId, recordId })
  );
};
