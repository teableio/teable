import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const CREATE_COMMENT_NOTIFY = '/comment/{tableId}/{recordId}/notify';

export const CreateCommentNotifyRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_COMMENT_NOTIFY,
  description: 'create record comment notify',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully create record notify.',
    },
  },
  tags: ['comment'],
});

export const createCommentNotify = async (tableId: string, recordId: string) => {
  return axios.post<void>(urlBuilder(CREATE_COMMENT_NOTIFY, { tableId, recordId }));
};
