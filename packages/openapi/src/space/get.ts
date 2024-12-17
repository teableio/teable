import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { roleSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_SPACE = '/space/{spaceId}';

export const getSpaceVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
  organization: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
});

export type IGetSpaceVo = z.infer<typeof getSpaceVoSchema>;

export const GetSpaceRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SPACE,
  description: 'Get a space by spaceId',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns information about a space.',
      content: {
        'application/json': {
          schema: getSpaceVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const getSpaceById = async (spaceId: string) => {
  return await axios.get<IGetSpaceVo>(
    urlBuilder(GET_SPACE, {
      spaceId,
    })
  );
};
