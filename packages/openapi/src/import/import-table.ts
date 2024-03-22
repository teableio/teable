import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IImportOptionRo } from '@teable/core';
import { importOptionRoSchema } from '@teable/core';
import { axios } from '../axios';
import type { ITableFullVo } from '../table';
import { tableVoSchema } from '../table';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

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
    200: {
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
