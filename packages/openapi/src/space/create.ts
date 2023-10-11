import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const CREATE_SPACE = '/space';

export const createSpaceRoSchema = z.object({
  name: z.string().optional(),
});

export type ICreateSpaceRo = z.infer<typeof createSpaceRoSchema>;

export const createSpaceVoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type ICreateSpaceVo = z.infer<typeof createSpaceVoSchema>;

export const CreateSpaceRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_SPACE,
  description: 'Create a space',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createSpaceRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns information about a successfully created space.',
      content: {
        'application/json': {
          schema: createSpaceVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const createSpace = async (createSpaceRo: ICreateSpaceRo) => {
  return axios.post<ICreateSpaceVo>(CREATE_SPACE, createSpaceRo);
};
