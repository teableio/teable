import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely } from 'kysely';
import { z } from 'zod';

// Use duck typing instead of instanceof check because webpack bundling
// can create multiple copies of the Kysely class, causing instanceof to fail.
// We check for characteristic Kysely methods instead.
const isKyselyLike = (value: unknown): value is Kysely<V1TeableDatabase> => {
  if (value instanceof Kysely) return true;
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.selectFrom === 'function' &&
    typeof obj.insertInto === 'function' &&
    typeof obj.updateTable === 'function' &&
    typeof obj.deleteFrom === 'function'
  );
};

const dbSchema = z.custom<Kysely<V1TeableDatabase>>(
  isKyselyLike,
  'Invalid Kysely database instance'
);

export const v2PostgresStateAdapterConfigSchema = z.object({
  db: dbSchema,
  ensureSchema: z.boolean().optional(),
  maxFreeRowLimit: z.coerce.number().int().nonnegative().optional(),
  seed: z
    .object({
      spaceId: z.string().min(1).default('spc_default'),
      baseId: z.string().min(1).default('bse_default'),
      actorId: z.string().min(1).default('system'),
    })
    .default(() => ({ spaceId: 'spc_default', baseId: 'bse_default', actorId: 'system' })),
});

export type IV2PostgresStateAdapterConfig = z.infer<typeof v2PostgresStateAdapterConfigSchema>;
