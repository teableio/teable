import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const CHAT_SUGGESTIONS = '/base/{baseId}/chat/suggestions';

export enum ChatSuggestionType {
  RECOMMEND = 'recommend',
  ASK = 'ask',
  ANALYZE = 'analyze',
  BUILD = 'build',
}

export const chatSuggestionsRoSchema = z.object({
  type: z.nativeEnum(ChatSuggestionType),
  lang: z.string().optional(),
});

export type IChatSuggestionsRo = z.infer<typeof chatSuggestionsRoSchema>;

export const chatSuggestionsVoSchema = z.object({
  suggestions: z.array(z.string()),
});

export type IChatSuggestionsVo = z.infer<typeof chatSuggestionsVoSchema>;

export const chatSuggestionsRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CHAT_SUGGESTIONS,
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: chatSuggestionsRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Chat suggestions',
    },
  },
});

export const chatSuggestions = async (baseId: string, ro: IChatSuggestionsRo) => {
  return axios.post<IChatSuggestionsVo>(urlBuilder(CHAT_SUGGESTIONS, { baseId }), ro);
};
