import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { roleSchema } from '@teable/core';
import { axios } from '../axios';
import { CollaboratorType } from '../space/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_BASE = '/base/{baseId}';

export const getBaseItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
  icon: z.string().nullable(),
  role: roleSchema,
  collaboratorType: z.nativeEnum(CollaboratorType).optional(),
  restrictedAuthority: z.boolean().optional(),
});

export const getBaseVoSchema = getBaseItemSchema;

export type IGetBaseVo = z.infer<typeof getBaseVoSchema>;

export const GetBaseRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE,
  description: 'Get a base by baseId',
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
  return axios.get<IGetBaseVo>(
    urlBuilder(GET_BASE, {
      baseId,
    })
  );
};
