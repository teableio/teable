import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const CREATE_BASE = '/base';

export const createBaseRoSchema = z.object({
  spaceId: z.string(),
  name: z.string().optional(),
  icon: z.string().optional(),
});

export type ICreateBaseRo = z.infer<typeof createBaseRoSchema>;

export const createBaseVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
});

export type ICreateBaseVo = z.infer<typeof createBaseVoSchema>;

export const CreateBaseRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_BASE,
  description: 'Create a base',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createBaseRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns information about a successfully created base.',
      content: {
        'application/json': {
          schema: createBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const createBase = async (createBaseRo: ICreateBaseRo) => {
  return axios.post<ICreateBaseVo>(CREATE_BASE, createBaseRo);
};
