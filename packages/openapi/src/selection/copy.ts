import { fieldVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';
import { rangesSchema } from './range';

export const COPY_URL = '/table/{tableId}/view/{viewId}/selection/copy';

export type ICopyRo = z.infer<typeof rangesSchema>;

export const copyVoSchema = z.object({
  content: z.string(),
  header: fieldVoSchema.array(),
});

export type ICopyVo = z.infer<typeof copyVoSchema>;

export const CopyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: COPY_URL,
  description: 'Copy operations in tables',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    query: rangesSchema,
  },
  responses: {
    200: {
      description: 'Copy content',
      content: {
        'application/json': {
          schema: copyVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const copy = async (tableId: string, viewId: string, copyRo: ICopyRo) => {
  return axios.get<ICopyVo>(
    urlBuilder(COPY_URL, {
      tableId,
      viewId,
    }),
    { params: copyRo }
  );
};
