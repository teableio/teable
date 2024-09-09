import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const GET_COMMENT_NOTIFY = '/comment/{tableId}/{recordId}/notify';

export const GetCommentNotifyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_COMMENT_NOTIFY,
  description: 'get record comment notify detail',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully get record comment notify.',
    },
  },
  tags: ['comment'],
});

export const getCommentNotify = async (tableId: string, recordId: string) => {
  return axios.get<void>(urlBuilder(GET_COMMENT_NOTIFY, { tableId, recordId }));
};
