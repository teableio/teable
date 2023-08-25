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

export const singleNumberShowAsSchema = z.object({
  type: z.nativeEnum(SingleNumberDisplayType),
  color: z.nativeEnum(Colors),
  showValue: z.boolean(),
  maxValue: z.number(),
});

export const multiNumberShowAsSchema = z.object({
  type: z.nativeEnum(MultiNumberDisplayType),
  color: z.nativeEnum(Colors),
});

export type ISingleNumberShowAs = z.infer<typeof singleNumberShowAsSchema>;

export type IMultiNumberShowAs = z.infer<typeof multiNumberShowAsSchema>;

export const numberShowAsSchema = z.union([singleNumberShowAsSchema, multiNumberShowAsSchema]);

export type INumberShowAs = z.infer<typeof numberShowAsSchema>;
