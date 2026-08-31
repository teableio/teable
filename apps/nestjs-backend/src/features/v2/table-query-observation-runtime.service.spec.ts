import type { ConfigService } from '@nestjs/config';
import type { PgPoolRegistry } from '@teable/db-main-prisma';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TableQueryObservationRuntimeService } from './table-query-observation-runtime.service';

const mocks = vi.hoisted(() => ({
  bufferStop: vi.fn(),
  bufferPublish: vi.fn(),
  createDb: vi.fn(),
  ensureSchema: vi.fn(),
  pruneBefore: vi.fn().mockResolvedValue({ isErr: () => false }),
  findSearchHeatByTable: vi.fn().mockResolvedValue({ isErr: () => false, value: [] }),
  repositoryConstructor: vi.fn(),
}));

vi.mock('@teable/v2-adapter-db-postgres-pg', () => ({
  createV2PostgresDb: mocks.createDb,
}));

vi.mock('@teable/v2-adapter-table-query-ops-postgres', () => ({
  ensureTableQueryObservationSchema: mocks.ensureSchema,
  PostgresTableQueryObservationRepository: class PostgresTableQueryObservationRepository {
    constructor(db: unknown, options: unknown) {
      mocks.repositoryConstructor(db, options);
    }

    pruneBefore = mocks.pruneBefore;
    findSearchHeatByTable = mocks.findSearchHeatByTable;
  },
}));

vi.mock('@teable/v2-table-query-ops', () => ({
  BufferedTableQueryObservationPublisher: class BufferedTableQueryObservationPublisher {
    constructor(
      readonly sink: unknown,
      readonly options: unknown
    ) {}

    stop = mocks.bufferStop;
    publish = mocks.bufferPublish;
  },
}));

const databaseUrl = 'postgresql://teable:secret@db.example.com:5432/teable';

const createService = () => {
  const configService = {
    get: vi.fn((key: string) => (key === 'PRISMA_DATABASE_URL' ? databaseUrl : undefined)),
  };
  const release = vi.fn().mockResolvedValue(undefined);
  const pool = {};
  const pgPoolRegistry = {
    acquire: vi.fn().mockReturnValue({ pool, release }),
  };
  const destroy = vi.fn().mockResolvedValue(undefined);
  const db = { destroy };
  mocks.createDb.mockResolvedValue(db);
  mocks.ensureSchema.mockResolvedValue(undefined);

  return {
    service: new TableQueryObservationRuntimeService(
      configService as unknown as ConfigService,
      pgPoolRegistry as unknown as PgPoolRegistry
    ),
    configService,
    db,
    destroy,
    pgPoolRegistry,
    pool,
    release,
  };
};

describe('TableQueryObservationRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates one process-wide runtime on an isolated max-two pool', async () => {
    const { service, pgPoolRegistry, pool } = createService();

    const [first, second] = await Promise.all([service.get(), service.get()]);

    expect(first).toBe(second);
    expect(pgPoolRegistry.acquire).toHaveBeenCalledOnce();
    expect(pgPoolRegistry.acquire).toHaveBeenCalledWith(databaseUrl, {
      applicationName: 'teable-table-query-observation',
      connectionTimeoutMillis: 5_000,
      max: 2,
      poolName: 'table-query-observation',
    });
    expect(mocks.createDb).toHaveBeenCalledWith(
      { pg: { connectionString: databaseUrl } },
      { pool }
    );
    expect(mocks.ensureSchema).toHaveBeenCalledOnce();
    expect(mocks.repositoryConstructor).toHaveBeenCalledWith(expect.anything(), {
      lockTimeoutMs: 250,
      statementTimeoutMs: 500,
    });
    expect(first).toMatchObject({ db: expect.anything(), publisher: expect.anything() });
  });

  it('can use a pre-provisioned observation schema without running DDL', async () => {
    const { service, configService } = createService();
    configService.get.mockImplementation((key: string) => {
      if (key === 'PRISMA_DATABASE_URL') return databaseUrl;
      if (key === 'V2_TABLE_QUERY_OPS_ENSURE_SCHEMA') return 'false';
      return undefined;
    });

    await service.get();

    expect(mocks.ensureSchema).not.toHaveBeenCalled();
  });

  it('retries through its stable publisher after a transient initialization failure', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { service } = createService();
    mocks.createDb.mockRejectedValueOnce(new Error('temporary setup failure'));

    service.publish({} as never, {} as never);
    await expect(service.get()).resolves.toBeUndefined();
    expect(mocks.bufferPublish).not.toHaveBeenCalled();

    now.mockReturnValue(6_001);
    service.publish({} as never, {} as never);
    await expect(service.get()).resolves.toBeDefined();
    await Promise.resolve();

    expect(mocks.createDb).toHaveBeenCalledTimes(2);
    expect(mocks.bufferPublish).toHaveBeenCalledOnce();
    now.mockRestore();
  });

  it('degrades instead of rejecting when pool acquisition throws synchronously', async () => {
    const { service, pgPoolRegistry } = createService();
    pgPoolRegistry.acquire.mockImplementationOnce(() => {
      throw new Error('registry shutting down');
    });

    await expect(service.get()).resolves.toBeUndefined();
  });

  it('keeps the runtime active and retries when schema ensure fails', async () => {
    vi.useFakeTimers();
    const { service, destroy, release } = createService();
    mocks.ensureSchema.mockRejectedValueOnce(new Error('schema unavailable'));

    await expect(service.get()).resolves.toBeDefined();
    await Promise.resolve();
    expect(mocks.ensureSchema).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.ensureSchema).toHaveBeenCalledTimes(2);
    expect(destroy).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    await service.dispose();
    vi.useRealTimers();
  });

  it('prunes shards older than the retention window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00.000Z'));
    const { service } = createService();
    await service.get();

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);

    expect(mocks.pruneBefore).toHaveBeenCalledWith(new Date('2026-07-15T00:00:00.000Z'));
    await service.dispose();
    vi.useRealTimers();
  });

  it('drops pending observations before releasing its isolated pool on shutdown', async () => {
    const { service, destroy, release } = createService();
    await service.get();
    await service.dispose();

    expect(mocks.bufferStop).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('delegates table-level search heat reads to the observation repository', async () => {
    const { service } = createService();
    const input = {
      since: new Date('2026-08-28T00:00:00.000Z'),
      minSlowCount: 5,
      limit: 10,
    };

    const result = await service.findSearchHeatByTable({} as never, input);

    expect(mocks.findSearchHeatByTable).toHaveBeenCalledWith(expect.anything(), input);
    expect(result.isErr()).toBe(false);
  });
});
