import { z } from 'zod';

export const v2PostgresDbConfigSchema = z.object({
  pg: z.object({
    connectionString: z.string().min(1),
    pool: z
      .object({
        max: z.number().int().min(1).optional(),
        idleTimeoutMillis: z.number().int().min(0).optional(),
        connectionTimeoutMillis: z.number().int().min(0).optional(),
        maxUses: z.number().int().min(1).optional(),
        allowExitOnIdle: z.boolean().optional(),
      })
      .optional(),
  }),
});

export type IV2PostgresDbConfig = z.infer<typeof v2PostgresDbConfigSchema>;
