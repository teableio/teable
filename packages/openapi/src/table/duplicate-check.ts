import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { crossSpaceAffectedFieldBaseSchema } from '../base/cross-space-affected-field';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DUPLICATE_TABLE_CHECK = '/base/{baseId}/table/{tableId}/duplicate-check';

export const crossSpaceTableAffectedFieldSchema = crossSpaceAffectedFieldBaseSchema;

export type ICrossSpaceTableAffectedField = z.infer<typeof crossSpaceTableAffectedFieldSchema>;

export const duplicateTableCheckVoSchema = z.object({
  affectedFields: z.array(crossSpaceTableAffectedFieldSchema),
});

export type IDuplicateTableCheckVo = z.infer<typeof duplicateTableCheckVoSchema>;

export const DuplicateTableCheckRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DUPLICATE_TABLE_CHECK,
  description:
    'Check the cross-space link/lookup/rollup fields that would be converted if this table were duplicated.',
  summary: 'Check cross-space affected fields for table duplicate',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'The list of cross-space affected fields.',
      content: {
        'application/json': {
          schema: duplicateTableCheckVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const duplicateTableCheck = async (baseId: string, tableId: string) => {
  return axios.get<IDuplicateTableCheckVo>(urlBuilder(DUPLICATE_TABLE_CHECK, { baseId, tableId }));
};
