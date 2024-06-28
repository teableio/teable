import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import type { IUsageVo } from './get-space-usage';
import { usageVoSchema } from './get-space-usage';

export const GET_INSTANCE_USAGE = '/instance/usage';

export const GetInstanceUsageRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_INSTANCE_USAGE,
  description: 'Get usage information for the instance',
  request: {},
  responses: {
    200: {
      description: 'Returns usage information for the instance.',
      content: {
        'application/json': {
          schema: usageVoSchema,
        },
      },
    },
  },
  tags: ['usage'],
});

export const getInstanceUsage = async () => {
  return axios.get<IUsageVo>(GET_INSTANCE_USAGE);
};
