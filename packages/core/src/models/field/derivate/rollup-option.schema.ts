import { z } from '../../../zod';
import { timeZoneStringSchema, unionFormattingSchema } from '../formatting';
import { unionShowAsSchema } from '../show-as';

export const ROLLUP_FUNCTIONS = [
  'countall({values})',
  'counta({values})',
  'count({values})',
  'sum({values})',
  'max({values})',
  'min({values})',
  'and({values})',
  'or({values})',
  'xor({values})',
  'array_join({values})',
  'array_unique({values})',
  'array_compact({values})',
  'concatenate({values})',
] as const;

export const rollupFieldOptionsSchema = z.object({
  expression: z.enum(ROLLUP_FUNCTIONS),
  timeZone: timeZoneStringSchema.optional(),
  formatting: unionFormattingSchema.optional(),
  showAs: unionShowAsSchema.optional(),
});

export type IRollupFieldOptions = z.infer<typeof rollupFieldOptionsSchema>;
