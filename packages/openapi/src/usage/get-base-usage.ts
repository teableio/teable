import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IUsageVo } from './get-space-usage';
import { usageVoSchema } from './get-space-usage';

export const GET_BASE_USAGE = '/base/{baseId}/usage';

export const GetBaseUsageRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_USAGE,
  description: 'Get usage information for the base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns usage information for the base.',
      content: {
        'application/json': {
          schema: usageVoSchema,
        },
      },
    },
  },
  tags: ['usage'],
});

export const getBaseUsage = async (baseId: string) => {
  return axios.get<IUsageVo>(urlBuilder(GET_BASE_USAGE, { baseId }));
};
