import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely } from 'kysely';
import { z } from 'zod';

// Use duck typing combined with instanceof check because webpack bundling
// can create multiple copies of the Kysely class, causing instanceof to fail.
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

export const v2PostgresDdlAdapterConfigSchema = z.object({
  db: dbSchema,
});

export type IV2PostgresDdlAdapterConfig = z.infer<typeof v2PostgresDdlAdapterConfigSchema>;
