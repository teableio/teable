import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorStorageRoutingService } from './actor-storage-routing.service';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  destroy: vi.fn(),
  release: vi.fn(),
  assertHeld: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
}));
vi.mock('@teable/db-data-prisma', () => ({ getMetaDatabaseUrl: () => 'postgresql://meta/db' }));
vi.mock('@teable/v2-adapter-db-postgres-pg', () => ({
  V2PgTableSchemaCoordination: class {
    acquire = mocks.acquire;
    destroy = mocks.destroy;
  },
}));
vi.mock('pg', () => ({
  Client: class {
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
    on = mocks.on;
  },
}));

const columns = [
  '__created_by_actor_type',
  '__created_by_actor_id',
  '__last_modified_by_actor_type',
  '__last_modified_by_actor_id',
];
const catalog = () =>
  columns.map((name) => ({
    relation: '123',
    name,
    plainText: true,
    nullable: true,
    defaultExpression: null,
    identityKind: '',
    generatedKind: '',
  }));

describe('ActorStorageRoutingService', () => {
  const prisma = { tableMeta: { findMany: vi.fn() } };
  const ancestry = new Map<string, unknown>();
  const cls = { get: vi.fn(() => ancestry) };
  const runtime = { deleteByKey: vi.fn() };
  const tx = { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() };
  let service: ActorStorageRoutingService;

  beforeEach(() => {
    vi.clearAllMocks();
    ancestry.clear();
    mocks.acquire.mockResolvedValue({
      isErr: () => false,
      value: {
        fence: { backendPid: 123, transactionId: '456' },
        assertHeld: mocks.assertHeld,
        release: mocks.release,
      },
    });
    mocks.assertHeld.mockResolvedValue({ isErr: () => false });
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM pg_attribute') ? catalog() : [],
    }));
    tx.$queryRawUnsafe.mockResolvedValue([{ held: true }]);
    prisma.tableMeta.findMany.mockResolvedValue([
      { id: 'tbl1', baseId: 'bse1', dbTableName: 'bse1.records', actorStorageVersion: 1 },
    ]);
    service = new ActorStorageRoutingService(prisma as never, cls as never, runtime as never);
  });

  it('keeps prior capability only after all four destination columns are strictly verified', async () => {
    const lease = await service.acquire(['tbl1', 'tbl1'], 'postgresql://target/db');
    expect(mocks.acquire).toHaveBeenCalledWith(expect.anything(), ['tbl1'], 'exclusive');
    expect(mocks.query).toHaveBeenCalledWith('LOCK TABLE "bse1"."records" IN ACCESS SHARE MODE');
    await lease.invalidateInTransaction(tx);
    const sql = tx.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("type = 'table.actor_columns.enable'");
    expect(sql).toContain("status IN ('pending', 'running')");
    expect(sql).toContain('locked_at = NULL, locked_by = NULL');
    expect(sql).not.toContain('actor_storage_version');
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_locks'),
      ['tbl1'],
      123,
      '456'
    );
    ancestry.set('table:tbl1', { actorStorageVersion: 0 });
    ancestry.set('base:bse1', {});
    await lease.invalidateCaches(['source', 'target', 'source']);
    expect(ancestry.size).toBe(0);
    expect(runtime.deleteByKey.mock.calls).toEqual([['source'], ['target']]);
    expect(mocks.release).not.toHaveBeenCalled();
    await lease.release();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not promote legacy version zero or query its nonexistent actor columns', async () => {
    prisma.tableMeta.findMany.mockResolvedValue([
      { id: 'tbl1', baseId: 'bse1', dbTableName: 'bse1.records', actorStorageVersion: 0 },
    ]);
    const lease = await service.acquire(['tbl1'], 'postgresql://target/db');
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    await lease.invalidateInTransaction(tx);
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).not.toContain('actor_storage_version');
    await lease.release();
  });

  it('refuses cutover when an enabled destination is missing even one actor column', async () => {
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM pg_attribute') ? catalog().slice(0, 3) : [],
    }));
    await expect(service.acquire(['tbl1'], 'postgresql://target/db')).rejects.toThrow(
      'columns are missing'
    );
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it.each([
    { plainText: false },
    { nullable: false },
    { identityKind: 'a' },
    { generatedKind: 's' },
    { defaultExpression: "'user'::text" },
  ])('refuses incompatible target shape %j without resetting capability', async (invalid) => {
    mocks.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM pg_attribute')
        ? catalog().map((column, index) => (index === 0 ? { ...column, ...invalid } : column))
        : [],
    }));
    await expect(service.acquire(['tbl1'], 'postgresql://target/db')).rejects.toThrow(
      'columns are incompatible'
    );
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('checks the lease again in the metadata transaction and rejects a stale backend proof', async () => {
    const lease = await service.acquire(['tbl1'], 'postgresql://target/db');
    tx.$queryRawUnsafe.mockResolvedValue([{ held: false }]);
    await expect(lease.invalidateInTransaction(tx)).rejects.toThrow('schema lease was lost');
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    await lease.release();
  });

  it('rejects loss of target catalog locks before committing the binding', async () => {
    const lease = await service.acquire(['tbl1'], 'postgresql://target/db');
    mocks.on.mock.calls[0][1](new Error('connection lost'));
    await expect(lease.assertInTransaction(tx)).rejects.toThrow('catalog proof was lost');
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    await lease.release();
  });

  it('releases the coordination pool during module shutdown', async () => {
    await service.onModuleDestroy();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
