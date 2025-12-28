import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely } from 'kysely';
import { z } from 'zod';

const dbSchema = z.custom<Kysely<V1TeableDatabase>>(
  (value) => value instanceof Kysely,
  'Invalid Kysely database instance'
);

export const v2PostgresDdlAdapterConfigSchema = z.object({
  db: dbSchema,
});

export type IV2PostgresDdlAdapterConfig = z.infer<typeof v2PostgresDdlAdapterConfigSchema>;
