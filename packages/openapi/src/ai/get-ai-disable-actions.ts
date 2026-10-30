import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

/** @deprecated `ai/config` returns `disableActions`; the web app no longer calls this route. */
export const GET_AI_DISABLE_ACTIONS = '/{baseId}/ai/disable-ai-actions';

export const getAIDisableActionsVoSchema = z.object({
  disableActions: z.array(z.string()),
});

export type IGetAIDisableActionsVo = z.infer<typeof getAIDisableActionsVoSchema>;

export const GetAIDisableActionsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_AI_DISABLE_ACTIONS,
  description: 'Get the disable ai actions. Deprecated: read `disableActions` from the AI config.',
  deprecated: true,
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the configuration of ai.',
      content: {
        'application/json': {
          schema: getAIDisableActionsVoSchema,
        },
      },
    },
  },
  tags: ['ai'],
});

/** @deprecated Read `disableActions` from `getAIConfig`. */
export const getAIDisableActions = async (baseId: string) => {
  return axios.get<IGetAIDisableActionsVo>(urlBuilder(GET_AI_DISABLE_ACTIONS, { baseId }));
};
