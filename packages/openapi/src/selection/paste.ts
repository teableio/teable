import { fieldVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';
import { cellSchema, rangesSchema } from './range';

export const PASTE_URL = '/table/{tableId}/view/{viewId}/selection/paste';

export const pasteRoSchema = z.object({
  content: z.string().describe('Content to paste').openapi({
    example: 'John\tDoe\tjohn.doe@example.com',
  }),
  range: z
    .array(cellSchema)
    .describe(
      'The parameter "ranges" is used to represent the coordinates of a selected range in a table. '
    )
    .openapi({
      example: [
        [0, 0],
        [1, 1],
      ],
    }),
  type: rangesSchema.shape.type,
  header: z.array(fieldVoSchema).optional().describe('Table header for paste operation').openapi({
    example: [],
  }),
});

export type PasteRo = z.infer<typeof pasteRoSchema>;

export const pasteVoSchema = z.object({
  ranges: z.tuple([cellSchema, cellSchema]),
});

export type PasteVo = z.infer<typeof pasteVoSchema>;

export const PasteRoute: RouteConfig = registerRoute({
  method: 'patch',
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
  return axios.patch<null>(
    urlBuilder(PASTE_URL, {
      tableId,
      viewId,
    }),
    pasteRo
  );
};
