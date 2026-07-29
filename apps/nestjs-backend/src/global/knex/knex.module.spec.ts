import { Test } from '@nestjs/testing';
import { MetaPrismaService, PgPoolRegistry } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { CUSTOM_KNEX, DATA_KNEX, KnexModule, META_KNEX } from './knex.module';

describe('KnexModule', () => {
  it('delegates legacy Knex queries to the shared PostgreSQL pool', async () => {
    vi.stubEnv('PRISMA_DATABASE_URL', 'postgresql://user:pass@localhost:5432/teable');
    const connection = { release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(connection) };
    const poolRegistry = {
      acquire: vi.fn().mockReturnValue({ pool, release: vi.fn() }),
    };
    const module = await Test.createTestingModule({ imports: [KnexModule.register()] })
      .overrideProvider(MetaPrismaService)
      .useValue({})
      .overrideProvider(PgPoolRegistry)
      .useValue(poolRegistry)
      .compile();
    const metaKnex = module.get<Knex>(META_KNEX);

    expect(module.get(DATA_KNEX)).toBe(metaKnex);
    expect(module.get(CUSTOM_KNEX)).toBe(metaKnex);
    expect(metaKnex.client.pool).toBeUndefined();
    expect(poolRegistry.acquire).toHaveBeenCalledWith(process.env.PRISMA_DATABASE_URL);

    const acquired = await metaKnex.client.acquireConnection();
    await metaKnex.client.releaseConnection(acquired);
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();

    await module.close();
    vi.unstubAllEnvs();
  });
});
