import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { ITableFullVo } from '../table';
import { tableVoSchema } from '../table';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IImportOptionRo } from './types';
import { importOptionRoSchema } from './types';

export const IMPORT_TABLE = '/import/{baseId}';

export const ImportTableFromFileRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_TABLE,
  description: 'create table from file',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: importOptionRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns data about a table without records',
      content: {
        'application/json': {
          schema: tableVoSchema,
        },
      },
    },
  },
  tags: ['import'],
});

export const importTableFromFile = async (baseId: string, importRo: IImportOptionRo) => {
  return axios.post<ITableFullVo[]>(urlBuilder(IMPORT_TABLE, { baseId }), importRo);
};
