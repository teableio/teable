import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_BASE = '/base/{baseId}';

export const getBaseVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
  order: z.number(),
  icon: z.string().nullable(),
});

export type IGetBaseVo = z.infer<typeof getBaseVoSchema>;

export const GetBaseRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE,
  description: 'Get a base station by baseId',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns information about a base.',
      content: {
        'application/json': {
          schema: getBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const getBaseById = async (baseId: string) => {
  return await axios.get<IGetBaseVo>(
    urlBuilder(GET_BASE, {
      params: {
        baseId,
      },
    })
  );
};
