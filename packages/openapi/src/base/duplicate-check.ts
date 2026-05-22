import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { crossSpaceAffectedFieldBaseSchema } from './cross-space-affected-field';

export const DUPLICATE_BASE_CHECK = '/base/{baseId}/duplicate-check';

export const crossSpaceBaseAffectedFieldSchema = crossSpaceAffectedFieldBaseSchema.extend({
  tableId: z.string(),
  tableName: z.string(),
});

export type ICrossSpaceBaseAffectedField = z.infer<typeof crossSpaceBaseAffectedFieldSchema>;

export const duplicateBaseCheckVoSchema = z.object({
  affectedFields: z.array(crossSpaceBaseAffectedFieldSchema),
});

export type IDuplicateBaseCheckVo = z.infer<typeof duplicateBaseCheckVoSchema>;

export const DuplicateBaseCheckRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DUPLICATE_BASE_CHECK,
  description:
    'Check the cross-space link/lookup/rollup fields that would be converted if this base were duplicated into the given target space.',
  summary: 'Check cross-space affected fields for base duplicate',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: z.object({
      destSpaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'The list of cross-space affected fields grouped by table.',
      content: {
        'application/json': {
          schema: duplicateBaseCheckVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const duplicateBaseCheck = async (baseId: string, destSpaceId: string) => {
  return axios.get<IDuplicateBaseCheckVo>(urlBuilder(DUPLICATE_BASE_CHECK, { baseId }), {
    params: { destSpaceId },
  });
};
