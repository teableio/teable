import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const TOGGLE_TABLE_INDEX = '/base/{baseId}/table/{tableId}/index';

export enum TableIndex {
  trgmIndex = 'trgmIndex',
}
export const tableIndexTypeSchema = z.nativeEnum(TableIndex);

export type ITableIndexType = z.infer<typeof tableIndexTypeSchema>;

export const toggleIndexRoSchema = z.object({
  type: tableIndexTypeSchema,
});

export type IToggleIndexRo = z.infer<typeof toggleIndexRoSchema>;

export const ToggleTableIndexRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TOGGLE_TABLE_INDEX,
  description: 'toggle table index',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: toggleIndexRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns data about a table.',
    },
  },
  tags: ['table'],
});

export const toggleTableIndex = async (
  baseId: string,
  tableId: string,
  searchIndexRo: IToggleIndexRo
) => {
  return axios.post<void>(urlBuilder(TOGGLE_TABLE_INDEX, { baseId, tableId }), searchIndexRo);
};
