import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { tableFullVoSchema } from './create';

export const DUPLICATE_TABLE = '/base/{baseId}/table/{tableId}/duplicate';

export const duplicateTableRoSchema = z.object({
  name: z.string(),
  includeRecords: z.boolean(),
});

export const duplicateTableVoSchema = tableFullVoSchema
  .omit({
    records: true,
  })
  .extend({
    viewMap: z.record(z.string()),
    fieldMap: z.record(z.string()),
  });

export type IDuplicateTableVo = z.infer<typeof duplicateTableVoSchema>;

export type IDuplicateTableRo = z.infer<typeof duplicateTableRoSchema>;

export const DuplicateTableRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_TABLE,
  description: 'Duplicate a table',
  summary: 'Duplicate a table',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: duplicateTableRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Duplicate successfully',
    },
  },
  tags: ['table'],
});

export const duplicateTable = async (
  baseId: string,
  tableId: string,
  duplicateRo: IDuplicateTableRo
) => {
  return axios.post<IDuplicateTableVo>(
    urlBuilder(DUPLICATE_TABLE, {
      baseId,
      tableId,
    }),
    duplicateRo
  );
};
