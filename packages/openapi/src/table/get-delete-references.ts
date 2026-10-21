import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import {
  fieldDeleteRefDependentFieldSchema,
  type IFieldDeleteRefDependentField,
} from '../field/get-delete-references';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_TABLE_DELETE_REFERENCES = '/base/{baseId}/table/{tableId}/delete-references';

export const tableDeleteReferencesVoSchema = z.object({
  dependentFields: z.array(fieldDeleteRefDependentFieldSchema),
});

export type ITableDeleteReferencesVo = z.infer<typeof tableDeleteReferencesVoSchema>;
export type ITableDeleteRefDependentField = IFieldDeleteRefDependentField;

export const getTableDeleteReferencesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TABLE_DELETE_REFERENCES,
  description:
    'Get fields on other tables that will be converted or errored when this table is deleted',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: tableDeleteReferencesVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const getTableDeleteReferences = async (baseId: string, tableId: string) => {
  return axios.get<ITableDeleteReferencesVo>(
    urlBuilder(GET_TABLE_DELETE_REFERENCES, { baseId, tableId })
  );
};
