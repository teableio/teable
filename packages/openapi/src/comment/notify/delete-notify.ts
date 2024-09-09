import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const DELETE_COMMENT_NOTIFY = '/comment/{tableId}/{recordId}/notify';

export const DeleteCommentNotifyRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_COMMENT_NOTIFY,
  description: 'delete record comment notify',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successfully delete record notify.',
    },
  },
  tags: ['comment'],
});

export const deleteCommentNotify = async (tableId: string, recordId: string) => {
  return axios.delete<void>(urlBuilder(DELETE_COMMENT_NOTIFY, { tableId, recordId }));
};
