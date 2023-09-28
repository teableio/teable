import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const COPY_URL = '/table/{tableId}/view/{viewId}/selection/copy';

export enum RangeType {
  Rows = 'Rows',
  Columns = 'Columns',
}

export const cellSchema = z.tuple([z.number(), z.number()]);

export const copyRoSchema = z.object({
  ranges: z
    .string()
    .refine((value) => z.array(cellSchema).safeParse(JSON.parse(value)).success, {
      message: 'The range parameter must be a valid 2D array with even length.',
    })
    .openapi({
      description:
        'The parameter "ranges" is used to represent the coordinates of a selected range in a table. ',
      example: '[[0, 0],[1, 1]]',
    }),
  type: z.nativeEnum(RangeType).optional().openapi({
    description: 'Types of non-contiguous selections',
    example: RangeType.Columns,
  }),
});

export type CopyRo = z.infer<typeof copyRoSchema>;

export const copyVoSchema = z.object({
  content: z.string(),
  header: fieldVoSchema.array(),
});

export type CopyVo = z.infer<typeof copyVoSchema>;

export const CopyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: COPY_URL,
  description: 'Copy operations in tables',
  request: {
    params: z.object({
      teableId: z.string(),
      viewId: z.string(),
    }),
    query: copyRoSchema,
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

export const copy = async (tableId: string, viewId: string, copyRo: CopyRo) => {
  return axios.get<CopyVo>(
    urlBuilder(COPY_URL, {
      params: { tableId, viewId },
      query: copyRo,
    })
  );
};
