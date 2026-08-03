import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { columnSchemaBase, IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { contentQueryBaseSchema, getRecordQuerySchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const EXPORT_CSV_FROM_TABLE = '/export/{tableId}';

export const exportCsvQuerySchema = contentQueryBaseSchema.pick({
  viewId: true,
  ignoreViewQuery: true,
  filter: true,
  orderBy: true,
  groupBy: true,
});

// Simplified columnMeta schema for export sorting - only needs order field
const exportColumnMetaSchema = z.record(
  z.string().startsWith(IdPrefix.Field),
  columnSchemaBase.pick({ order: true })
);

export const exportCsvRoSchema = exportCsvQuerySchema
  .extend(getRecordQuerySchema.pick({ projection: true }).shape)
  .extend({
    columnMeta: z
      .preprocess((val) => {
        if (val == null) return val;
        if (typeof val === 'string') {
          try {
            return JSON.parse(val);
          } catch {
            return val;
          }
        }
        return val;
      }, exportColumnMetaSchema.optional())
      .optional()
      .meta({
        type: 'string',
        description:
          'When ignoreViewQuery is true, use this columnMeta to sort fields by order. Format: { fieldId: { order: number } }',
      }),
  });

export type IExportCsvRo = z.infer<typeof exportCsvRoSchema>;

export const ExportCsvFromTableRoute: RouteConfig = registerRoute({
  method: 'get',
  path: EXPORT_CSV_FROM_TABLE,
  description: 'export csv from table',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: exportCsvRoSchema,
  },
  responses: {
    200: {
      description: 'Download successful',
    },
  },
  tags: ['export'],
});

export const exportCsvFromTable = async (tableId: string, query?: IExportCsvRo) => {
  const serializedQuery = {
    ...query,
    filter: query?.filter ? JSON.stringify(query.filter) : undefined,
    orderBy: query?.orderBy ? JSON.stringify(query.orderBy) : undefined,
    groupBy: query?.groupBy ? JSON.stringify(query.groupBy) : undefined,
    columnMeta: query?.columnMeta ? JSON.stringify(query.columnMeta) : undefined,
  };

  return axios.get(urlBuilder(EXPORT_CSV_FROM_TABLE, { tableId }), {
    params: serializedQuery,
  });
};
