import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DUPLICATE_BASE = '/base/{baseId}/duplicate';

export const duplicateBaseRoSchema = z.object({
  toSpaceId: z.string().openapi({
    description: 'The space to duplicate the base to',
  }),
  withRecords: z.boolean().optional().openapi({
    description: 'Whether to duplicate the records',
  }),
  name: z.string().optional().openapi({
    description: 'The name of the duplicated base',
  }),
});

export type IDuplicateBaseRo = z.infer<typeof duplicateBaseRoSchema>;

export const duplicateBaseVoSchema = z.object({
  baseId: z.string().openapi({
    description: 'The id of the duplicated base',
  }),
});

export type IDuplicateBaseVo = z.infer<typeof duplicateBaseVoSchema>;

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
          schema: duplicateBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const duplicateBase = async (baseId: string, duplicateBaseRo: IDuplicateBaseRo) => {
  return axios.post<IDuplicateBaseVo>(
    urlBuilder(DUPLICATE_BASE, {
      baseId,
    }),
    duplicateBaseRo
  );
};
