import type { Message } from '@ai-sdk/ui-utils';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IChatMessageUsage } from './types';

export const GET_CHAT_MESSAGES = '/base/{baseId}/chat/{chatId}/messages';

export interface IChatMessage {
  id: string;
  name: string;
  chatId: string;
  role: Message['role'];
  parts: Message['parts'];
  createdTime: string;
  createdBy: string;
  usage?: IChatMessageUsage;
  timeCost?: number;
}

export interface IChatMessageVo {
  messages: IChatMessage[];
}

export const getChatMessagesRoute = registerRoute({
  method: 'get',
  path: GET_CHAT_MESSAGES,
  description: 'Get chat messages',
  request: {
    params: z.object({
      baseId: z.string(),
      chatId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Chat messages',
    },
  },
  tags: ['chat'],
});

export const getChatMessages = async (baseId: string, chatId: string) => {
  return axios.get<IChatMessageVo>(urlBuilder(GET_CHAT_MESSAGES, { baseId, chatId }));
};
