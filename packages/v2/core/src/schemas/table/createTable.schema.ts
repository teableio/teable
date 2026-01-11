import { z } from 'zod';

import { tableFieldInputSchema } from '../field/tableField.schema';
import { viewInputSchema } from './view.schema';

export const recordInputSchema = z.object({
  id: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
});

export const createTableInputSchema = z.object({
  baseId: z.string(),
  tableId: z.string().optional(),
  name: z.string(),
  fields: z.array(tableFieldInputSchema).default([]),
  views: z.array(viewInputSchema).optional(),
  records: z.array(recordInputSchema).optional(),
});

export type ICreateTableInput = z.input<typeof createTableInputSchema>;
export type IRecordInput = z.output<typeof recordInputSchema>;
