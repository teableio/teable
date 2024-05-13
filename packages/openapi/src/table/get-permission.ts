import { ActionPrefix, actionPrefixMap } from '@teable/core';
import type {
  ExcludeAction,
  FieldActions,
  RecordActions,
  TableActions,
  ViewActions,
} from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_TABLE_PERMISSION = '/base/{baseId}/table/{tableId}/permission';

export type TablePermissionFieldActions = ExcludeAction<FieldActions, 'field|create'>;

export const FieldActionsExcludeCreate = actionPrefixMap[ActionPrefix.Field].filter(
  (action) => action !== 'field|create'
) as TablePermissionFieldActions[];

export const tablePermissionVoSchema = z.object({
  table: z.record(z.custom<TableActions>(), z.boolean()),
  view: z.record(z.custom<ViewActions>(), z.boolean()),
  record: z.record(z.custom<RecordActions>(), z.boolean()),
  field: z.object({
    fields: z.record(z.string(), z.record(z.custom<TablePermissionFieldActions>(), z.boolean())),
    create: z.boolean(),
  }),
});

export type ITablePermissionVo = z.infer<typeof tablePermissionVoSchema>;

export const GetTablePermissionRoute = registerRoute({
  method: 'get',
  path: GET_TABLE_PERMISSION,
  description: 'Get a table permission',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about a table permission.',
      content: {
        'application/json': {
          schema: tablePermissionVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTablePermission = async (baseId: string, tableId: string) => {
  return axios.get<ITablePermissionVo>(
    urlBuilder(GET_TABLE_PERMISSION, {
      baseId,
      tableId,
    })
  );
};
