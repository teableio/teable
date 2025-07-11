import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { ICreateBaseVo } from './create';
import { createBaseVoSchema } from './create';

export const DUPLICATE_BASE = '/base/duplicate';

export const duplicateBaseRoSchema = z.object({
  fromBaseId: z.string().openapi({
    description: 'The base to duplicate',
  }),
  spaceId: z.string().openapi({
    description: 'The space to duplicate the base to',
  }),
  withRecords: z.boolean().optional().openapi({
    description: 'Whether to duplicate the records',
  }),
  name: z.string().optional().openapi({
    description: 'The name of the duplicated base',
  }),
  baseId: z.string().optional(),
});

export type IDuplicateBaseRo = z.infer<typeof duplicateBaseRoSchema>;

export const DuplicateBaseRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_BASE,
  description: 'duplicate a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: duplicateBaseRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns information about a successfully duplicated base.',
      content: {
        'application/json': {
          schema: createBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const duplicateBase = async (params: IDuplicateBaseRo) => {
  return axios.post<ICreateBaseVo>(DUPLICATE_BASE, params);
};
