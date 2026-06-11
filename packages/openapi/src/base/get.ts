import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { roleSchema } from '@teable/core';
import { axios } from '../axios';
import { CollaboratorType } from '../space/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_BASE = '/base/{baseId}';

export const v2ReasonSchema = z.enum([
  'env_force_v2_all',
  'config_force_v2_all',
  'new_base',
  'header_override',
  'space_feature',
  'unsupported_feature',
  'disabled',
  'feature_not_enabled',
  'no_feature',
]);

export const baseV2StatusSchema = z.object({
  useV2: z.boolean(),
  reason: v2ReasonSchema,
});

export const getBaseItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
  icon: z.string().nullable(),
  role: roleSchema,
  collaboratorType: z.enum(CollaboratorType).optional(),
  restrictedAuthority: z.boolean().optional(),
  enabledAuthority: z.boolean().optional(),
  lastModifiedTime: z.string().nullable().optional(),
  createdTime: z.string().nullable().optional(),
  createdBy: z.string(),
  template: z
    .object({
      id: z.string(),
      headers: z.string(),
    })
    .optional(),
  createdUser: z
    .object({
      id: z.string(),
      name: z.string(),
      avatar: z.string().nullable().optional(),
    })
    .optional(),
  isCanary: z.boolean().optional(),
  v2Status: baseV2StatusSchema.optional(),
  isShared: z.boolean().optional(),
});

export const getBaseVoSchema = getBaseItemSchema;

export type IBaseV2StatusVo = z.infer<typeof baseV2StatusSchema>;
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
