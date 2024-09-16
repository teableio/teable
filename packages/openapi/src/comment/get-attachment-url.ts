import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_COMMENT_ATTACHMENT_URL = '/comment/{tableId}/{recordId}/attachment/{path}';

export const GetCommentAttachmentUrlRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_COMMENT_ATTACHMENT_URL,
  description: 'Get record comment attachment url',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Returns the record's comment attachment url",
      content: {
        'application/json': {
          schema: z.string(),
        },
      },
    },
  },
  tags: ['comment'],
});

export const getCommentAttachmentUrl = async (tableId: string, recordId: string, path: string) => {
  return axios.get<string>(urlBuilder(GET_COMMENT_ATTACHMENT_URL, { tableId, recordId, path }));
};
