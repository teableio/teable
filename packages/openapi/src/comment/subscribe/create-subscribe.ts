import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const CREATE_COMMENT_SUBSCRIBE = '/comment/{tableId}/{recordId}/subscribe';

export const CreateCommentSubscribeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_COMMENT_SUBSCRIBE,
  description: "subscribe record comment's active",
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Successfully subscribe record comment.',
    },
  },
  tags: ['comment'],
});

export const createCommentSubscribe = async (tableId: string, recordId: string) => {
  return axios.post<void>(urlBuilder(CREATE_COMMENT_SUBSCRIBE, { tableId, recordId }));
};
