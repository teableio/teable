import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { notifyVoSchema } from '../attachment';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const IMPORT_UNSUBSCRIBE_LIST = '/unsubscribe/import-list/{baseId}';

export const importUnsubscribeListRoSchema = z.object({
  notify: notifyVoSchema,
});

export type ImportUnsubscribeListRo = z.infer<typeof importUnsubscribeListRoSchema>;

export const importUnsubscribeListRoute: RouteConfig = registerRoute({
  method: 'post',
  path: IMPORT_UNSUBSCRIBE_LIST,
  description: 'Import unsubscribe list',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: importUnsubscribeListRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: z.boolean(),
        },
      },
    },
  },
  tags: ['unsubscribe'],
});

export const importUnsubscribeList = async (
  baseId: string,
  importUnsubscribeListRo: ImportUnsubscribeListRo
) => {
  return axios.post<boolean>(
    urlBuilder(IMPORT_UNSUBSCRIBE_LIST, { baseId }),
    importUnsubscribeListRo
  );
};
