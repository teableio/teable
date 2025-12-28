import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely } from 'kysely';
import { z } from 'zod';

const dbSchema = z.custom<Kysely<V1TeableDatabase>>(
  (value) => value instanceof Kysely,
  'Invalid Kysely database instance'
);

export const v2PostgresStateAdapterConfigSchema = z.object({
  db: dbSchema,
  ensureSchema: z.boolean().optional(),
  seed: z
    .object({
      spaceId: z.string().min(1).default('spc_default'),
      baseId: z.string().min(1).default('bse_default'),
      actorId: z.string().min(1).default('system'),
    })
    .default(() => ({ spaceId: 'spc_default', baseId: 'bse_default', actorId: 'system' })),
});

export type IV2PostgresStateAdapterConfig = z.infer<typeof v2PostgresStateAdapterConfigSchema>;
