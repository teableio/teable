import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { cellSchema, rangesRoSchema } from './range';

export const PASTE_URL = '/table/{tableId}/selection/paste';

export const pasteRoSchema = rangesRoSchema.extend({
  content: z
    .string()
    .or(z.array(z.array(z.unknown())))
    .openapi({
      description: 'Content to paste',
      example: 'John\tDoe\tjohn.doe@example.com',
    }),
  header: z.array(fieldVoSchema).optional().openapi({
    description: 'Table header for paste operation',
    example: [],
  }),
});

export type IPasteRo = z.infer<typeof pasteRoSchema>;

export const pasteVoSchema = z.object({
  ranges: z.tuple([cellSchema, cellSchema]),
});

export type IPasteVo = z.infer<typeof pasteVoSchema>;

export const PasteRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PASTE_URL,
  summary: 'Paste content into selected range',
  description: 'Apply paste operation to insert content into the selected table range',
  request: {
    params: z.object({
      tableId: z.string(),
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

export const paste = async (tableId: string, pasteRo: IPasteRo) => {
  return axios.patch<IPasteVo>(
    urlBuilder(PASTE_URL, {
      tableId,
    }),
    pasteRo
  );
};
