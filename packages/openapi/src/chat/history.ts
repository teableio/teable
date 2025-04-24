import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_CHAT_HISTORY = '/base/{baseId}/chat/history';

export const ChatHistoryItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  createdTime: z.string(),
  createdBy: z.string(),
  lastModifiedTime: z.string().optional(),
});

export type IChatHistoryItem = z.infer<typeof ChatHistoryItem>;
export const getChatHistoryVoSchema = z.object({
  history: z.array(ChatHistoryItem),
  total: z.number(),
});

export type IGetChatHistoryVo = z.infer<typeof getChatHistoryVoSchema>;

export const getChatHistoryRoute = registerRoute({
  method: 'get',
  path: GET_CHAT_HISTORY,
  description: 'Get chat history',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Get chat history successfully',
      content: {
        'application/json': {
          schema: getChatHistoryVoSchema,
        },
      },
    },
  },
  tags: ['chat'],
});

export const getChatHistory = (baseId: string) => {
  return axios.get<IGetChatHistoryVo>(urlBuilder(GET_CHAT_HISTORY, { baseId }));
};
