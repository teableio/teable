import { z } from 'zod';

export const sqlQuerySchemaRo = z.object({
  tableId: z.string(),
  viewId: z.string(),
  sql: z.string(),
});

export type ISqlQuerySchemaRo = z.infer<typeof sqlQuerySchemaRo>;
