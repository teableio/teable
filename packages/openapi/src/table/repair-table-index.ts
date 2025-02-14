import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { TableIndex } from './toggle-table-index';
import { tableIndexTypeSchema } from './toggle-table-index';

export const TABLE_INDEX_REPAIR = '/base/{baseId}/table/{tableId}/index/repair';

export const TableIndexRepairRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: TABLE_INDEX_REPAIR,
  summary: 'Repair table index',
  description: 'Repair table index',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
      type: tableIndexTypeSchema,
    }),
  },
  responses: {
    201: {
      description: 'Succeed',
    },
  },
  tags: ['table'],
});

export const repairTableIndex = (baseId: string, tableId: string, type: TableIndex) => {
  return axios.patch<void>(urlBuilder(TABLE_INDEX_REPAIR, { baseId, tableId }), undefined, {
    params: { type },
  });
};
