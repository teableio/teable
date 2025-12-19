import { z } from 'zod';

import { v2PostgresDbConfigSchema } from '@teable/v2-db-postgres';

export const v2PostgresStateAdapterConfigSchema = v2PostgresDbConfigSchema.extend({
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
