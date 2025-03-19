import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { notifyVoSchema } from '../attachment';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { ICreateBaseVo } from './create';

export const IMPORT_BASE = '/base/import';

export const importBaseRoSchema = z.object({
  notify: notifyVoSchema,
  spaceId: z.string(),
});

export type ImportBaseRo = z.infer<typeof importBaseRoSchema>;

export const ImportBaseRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_BASE,
  description: 'import a base',
  summary: 'import a base',
  request: {
    body: {
      content: {
        'application/json': {
          schema: importBaseRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'import successfully',
    },
  },
  tags: ['base'],
});

export const importBase = async (importBaseRo: ImportBaseRo) => {
  return await axios.post<ICreateBaseVo>(urlBuilder(IMPORT_BASE), importBaseRo);
};
