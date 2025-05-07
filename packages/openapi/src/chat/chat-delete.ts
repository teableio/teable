import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CHAT_DELETE = '/base/{baseId}/chat/{chatId}/delete';

export const chatDeleteRoute = registerRoute({
  method: 'delete',
  path: CHAT_DELETE,
  request: {
    params: z.object({
      baseId: z.string(),
      chatId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Chat deleted',
    },
  },
});

export const chatDelete = async (baseId: string, chatId: string) => {
  return axios.delete<void>(urlBuilder(CHAT_DELETE, { baseId, chatId }));
};
