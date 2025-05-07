import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CHAT_RENAME = '/base/{baseId}/chat/{chatId}/rename';

export const chatRenameRoSchema = z.object({
  name: z.string().min(1),
});

export type IChatRenameRo = z.infer<typeof chatRenameRoSchema>;

export const chatRenameRoute = registerRoute({
  method: 'patch',
  path: CHAT_RENAME,
  request: {
    body: {
      content: {
        'application/json': {
          schema: chatRenameRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Chat renamed',
    },
  },
});

export const chatRename = async (baseId: string, chatId: string, name: string) => {
  return axios.patch<void>(urlBuilder(CHAT_RENAME, { baseId, chatId }), { name });
};
