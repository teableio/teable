import { fieldVoSchema } from '@teable-group/core';
import { z } from '../zod';

const cellSchema = z.tuple([z.number(), z.number()]);

export const pasteRoSchema = z.object({
  content: z.string().openapi({
    description: 'Content to paste',
    example: 'John\tDoe\tjohn.doe@example.com',
  }),
  cell: cellSchema.openapi({
    description: 'Starting cell for paste operation',
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

export enum RangeType {
  Rows = 'Rows',
  Columns = 'Columns',
}

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

export const clearRoSchema = z.object({
  ranges: z.array(cellSchema).openapi({
    description:
      'The parameter "ranges" is used to represent the coordinates of a selected range in a table. ',
    example: [
      [0, 0],
      [1, 1],
    ],
  }),
  type: copyRoSchema.shape.type,
});

export type ClearRo = z.infer<typeof clearRoSchema>;
