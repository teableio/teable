import { z } from 'zod';

export const v2PostgresDbConfigSchema = z.object({
  pg: z.object({
    connectionString: z.string().min(1),
  }),
});

export type IV2PostgresDbConfig = z.infer<typeof v2PostgresDbConfigSchema>;
