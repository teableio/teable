import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { cellSchema } from './range';

export const PASTE_URL = '/table/{tableId}/view/{viewId}/selection/paste';

export const pasteRoSchema = z.object({
  content: z.string().openapi({
    description: 'Content to paste',
    example: 'John\tDoe\tjohn.doe@example.com',
  }),
  cell: cellSchema.openapi({
    description: 'Starting cell for paste operation, [column, row]',
    example: [1, 2],
  }),
  header: z.array(fieldVoSchema).openapi({
    description: 'Table header for paste operation',
    example: [],
  }),
});

export type PasteRo = z.infer<typeof pasteRoSchema>;

export const pasteVoSchema = z.object({
  ranges: z.tuple([cellSchema, cellSchema]),
});

export type PasteVo = z.infer<typeof pasteVoSchema>;

export const PasteRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PASTE_URL,
  description: 'Copy operations in tables',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: pasteRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Paste successfully',
      content: {
        'application/json': {
          schema: pasteVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const paste = async (tableId: string, viewId: string, pasteRo: PasteRo) => {
  return axios.post<null>(
    urlBuilder(PASTE_URL, {
      tableId,
      viewId,
    }),
    pasteRo
  );
};
