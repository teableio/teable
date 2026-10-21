import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { usageVoSchema } from './get-space-usage';

export const GET_INSTANCE_USAGE = '/instance/usage';

export const instanceUsageVoSchema = usageVoSchema.extend({
  seats: z.number().optional(),
  seatLimit: z.number().optional(),
});

export type IInstanceUsageVo = z.infer<typeof instanceUsageVoSchema>;

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
          schema: instanceUsageVoSchema,
        },
      },
    },
  },
  tags: ['usage'],
});

export const getInstanceUsage = async () => {
  return axios.get<IInstanceUsageVo>(GET_INSTANCE_USAGE);
};
