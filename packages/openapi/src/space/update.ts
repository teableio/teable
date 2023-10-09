import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { createSpaceRoSchema, createSpaceVoSchema } from './create';

export const UPDATE_SPACE = '/space/{spaceId}';

export const updateSpaceRoSchema = createSpaceRoSchema;

export type IUpdateSpaceRo = z.infer<typeof createSpaceRoSchema>;

export const updateSpaceVoSchema = createSpaceVoSchema;

export type IUpdateSpaceVo = z.infer<typeof updateSpaceVoSchema>;

export const UpdateSpaceRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_SPACE,
  description: 'Update a space info',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateSpaceRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns information about a successfully updated space.',
      content: {
        'application/json': {
          schema: updateSpaceVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const updateSpace = async (params: { spaceId: string; updateSpaceRo: IUpdateSpaceRo }) => {
  const { spaceId, updateSpaceRo } = params;
  return axios.patch<IUpdateSpaceVo>(
    urlBuilder(UPDATE_SPACE, {
      spaceId,
    }),
    updateSpaceRo
  );
};
