import { z } from 'zod';

export const getSchemaInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string().optional(),
  projection: z.array(z.string()).optional(),
  filterHidden: z.coerce.boolean().optional(),
});
export type IGetSchemaRequestDto = z.input<typeof getSchemaInputSchema>;
