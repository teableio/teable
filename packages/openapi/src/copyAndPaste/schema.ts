import { fieldVoSchema } from '@teable-group/core';
import { z } from 'zod';

export const pasteRoSchema = z.object({
  content: z.string().openapi({
    description: 'Content to paste',
    example: 'John\tDoe\tjohn.doe@example.com',
  }),
  cell: z.tuple([z.number(), z.number()]).openapi({
    description: 'Starting cell for paste operation',
    example: [1, 2],
  }),
  header: z.array(fieldVoSchema).openapi({
    description: 'Table header for paste operation',
    example: [],
  }),
});

export type PasteRo = z.infer<typeof pasteRoSchema>;

const rangeValidator = (value: string) => {
  const arrayValue = JSON.parse(value);
  if (!Array.isArray(arrayValue) || arrayValue.length % 2 !== 0) {
    return false;
  }
  for (const arr of arrayValue) {
    if (!Array.isArray(arr) || arr.length !== 2) {
      return false;
    }
  }
  return true;
};

export enum RangeType {
  Column = 'column',
  Row = 'row',
}

export const copyRoSchema = z.object({
  ranges: z
    .string()
    .refine((value) => rangeValidator(value), {
      message: 'The range parameter must be a valid 2D array with even length.',
    })
    .openapi({
      description:
        'The parameter "ranges" is used to represent the coordinates of a selected range in a table. ',
      example: '[[0, 0],[1, 1]]',
    }),
  type: z.nativeEnum(RangeType).optional().openapi({
    description: 'Types of non-contiguous selections',
    example: RangeType.Column,
  }),
});

export type CopyRo = z.infer<typeof copyRoSchema>;

export const copyVoSchema = z.object({
  content: z.string(),
  header: z.array(fieldVoSchema),
});

export type CopyVo = z.infer<typeof copyVoSchema>;
