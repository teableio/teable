import { z } from 'zod';

export const sqlQuerySchemaRo = z.object({
  sql: z.string(),
  bindings: z.array(z.unknown()),
});

export type ISqlQuerySchemaRo = z.infer<typeof sqlQuerySchemaRo>;
