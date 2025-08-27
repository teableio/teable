import { z } from 'zod';
import { Colors } from '../colors';

export enum SingleNumberDisplayType {
  Bar = 'bar',
  Ring = 'ring',
}

export enum MultiNumberDisplayType {
  Bar = 'bar',
  Line = 'line',
}

export const singleNumberShowAsSchema = z
  .object({
    type: z.nativeEnum(SingleNumberDisplayType).openapi({
      description: 'can display as bar or ring in number field with single cellValue value',
    }),
    color: z.nativeEnum(Colors),
    showValue: z.boolean().openapi({
      description: 'whether to displays the specific value on the graph',
    }),
    maxValue: z.number().openapi({
      description:
        'the value that represents a 100% maximum value, it does not represent a hard limit on the value',
    }),
  })
  .describe('Only be used in number related field with isMultipleCellValue is not true');

export const multiNumberShowAsSchema = z
  .object({
    type: z.nativeEnum(MultiNumberDisplayType).openapi({
      description: 'can display as bar or line in number field with multiple cellValue value',
    }),
    color: z.nativeEnum(Colors),
  })
  .describe('Only be used in number related field with isMultipleCellValue is true');

export type ISingleNumberShowAs = z.infer<typeof singleNumberShowAsSchema>;

export type IMultiNumberShowAs = z.infer<typeof multiNumberShowAsSchema>;

export const numberShowAsSchema = z
  .union([singleNumberShowAsSchema.strict(), multiNumberShowAsSchema.strict()])
  .describe(
    'Only be used in number field (number field or formula / rollup field with cellValueType equals Number'
  );

export type INumberShowAs = z.infer<typeof numberShowAsSchema>;
