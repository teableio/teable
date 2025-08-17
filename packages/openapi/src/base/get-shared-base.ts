import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { getBaseItemSchema } from './get';

export const GET_SHARED_BASE = '/base/shared-base';

export const getSharedBaseItemSchema = getBaseItemSchema.extend({
  spaceName: z.string().optional(),
});

export const getSharedBaseVoSchema = z.array(getSharedBaseItemSchema);

export type IGetSharedBaseVo = z.infer<typeof getSharedBaseVoSchema>;

export const GetSharedBaseRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SHARED_BASE,
  responses: {
    200: {
      description: 'Returns information about a shared base.',
      content: {
        'application/json': {
          schema: getSharedBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const getSharedBase = async () => {
  return axios.get<IGetSharedBaseVo>(GET_SHARED_BASE);
};
