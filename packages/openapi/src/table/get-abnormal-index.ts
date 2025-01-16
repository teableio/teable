import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { TableIndex } from './toggle-table-index';
import { tableIndexTypeSchema } from './toggle-table-index';

export const TABLE_ABNORMAL_INDEX = '/base/{baseId}/table/{tableId}/abnormal-index';

export const getAbnormalVoSchema = z
  .object({
    indexName: z.string(),
  })
  .array();

export type IGetAbnormalVo = z.infer<typeof getAbnormalVoSchema>;

export const TableAbnormalIndexRoute: RouteConfig = registerRoute({
  method: 'get',
  path: TABLE_ABNORMAL_INDEX,
  description: 'Get abnormal index by type',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
      type: tableIndexTypeSchema,
    }),
  },
  responses: {
    201: {
      description: 'Returns table abnormal index',
      content: {
        'application/json': {
          schema: getAbnormalVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableAbnormalIndex = (baseId: string, tableId: string, type: TableIndex) => {
  return axios.get<IGetAbnormalVo>(urlBuilder(TABLE_ABNORMAL_INDEX, { baseId, tableId }), {
    params: { type },
  });
};
