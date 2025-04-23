import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema, recordSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { rangesRoSchema } from './range';

export const TEMPORARY_PASTE_URL = '/table/{tableId}/selection/temporaryPaste';

export const temporaryPasteRoSchema = rangesRoSchema
  .pick({
    viewId: true,
    ranges: true,
    projection: true,
    ignoreViewQuery: true,
  })
  .extend({
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

export type ITemporaryPasteRo = z.infer<typeof temporaryPasteRoSchema>;

export const temporaryPasteVoSchema = z.array(
  recordSchema.pick({
    fields: true,
  })
);

export type ITemporaryPasteVo = z.infer<typeof temporaryPasteVoSchema>;

export const temporaryPasteRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: TEMPORARY_PASTE_URL,
  summary: 'Preview paste operation results',
  description: 'Preview the results of a paste operation without applying changes to the table',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: temporaryPasteRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Paste successfully',
      content: {
        'application/json': {
          schema: temporaryPasteVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const temporaryPaste = async (tableId: string, pasteRo: ITemporaryPasteRo) => {
  return axios.patch<ITemporaryPasteVo>(
    urlBuilder(TEMPORARY_PASTE_URL, {
      tableId,
    }),
    pasteRo
  );
};
