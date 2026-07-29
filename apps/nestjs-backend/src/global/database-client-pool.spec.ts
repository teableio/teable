import { Test } from '@nestjs/testing';
import { DataPrismaModule, DataPrismaService } from '@teable/db-data-prisma';
import {
  MetaPrismaService,
  PG_POOL_FACTORY,
  PgPoolRegistry,
  PrismaModule,
} from '@teable/db-main-prisma';
import { ClsModule } from 'nestjs-cls';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('database client pool composition', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('constructs both Prisma clients over one process-owned PostgreSQL pool', async () => {
    vi.stubEnv(
      'PRISMA_META_DATABASE_URL',
      'postgresql://teable:secret@db.example.com:5432/teable?schema=public&connection_limit=12'
    );
    const pool = new Pool();
    const end = vi.spyOn(pool, 'end').mockResolvedValue(undefined);
    const poolFactory = vi.fn().mockReturnValue(pool);
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true }), PrismaModule, DataPrismaModule],
    })
      .overrideProvider(PG_POOL_FACTORY)
      .useValue(poolFactory)
      .compile();

    expect(module.get(MetaPrismaService)).toBeDefined();
    expect(module.get(DataPrismaService)).toBeDefined();
    expect(poolFactory).toHaveBeenCalledOnce();
    expect(module.get(PgPoolRegistry).snapshot()).toEqual([
      expect.objectContaining({ max: 12, references: 2 }),
    ]);

    await module.close();

    expect(end).toHaveBeenCalledOnce();
  });
});
