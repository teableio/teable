import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';
import {
  createTableSchemaCoordinationLease,
  TableSchemaCoordination,
  type ITableSchemaCoordinationLease,
  type TableSchemaCoordinationMode,
} from './TableSchemaCoordination';

class FakeTableSchemaCoordination extends TableSchemaCoordination {
  readonly acquireCalls: Array<{ tableIds: string[]; mode: TableSchemaCoordinationMode }> = [];
  readonly releasedTableIds: string[][] = [];

  protected async acquireLocks(
    _context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>> {
    this.acquireCalls.push({ tableIds: [...tableIds], mode });
    return ok(
      createTableSchemaCoordinationLease(mode, tableIds, async () => {
        this.releasedTableIds.push([...tableIds]);
      })
    );
  }
}

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

describe('TableSchemaCoordination', () => {
  it('acquires requested table locks in sorted order and releases them', async () => {
    const coordination = new FakeTableSchemaCoordination();
    const leaseResult = await coordination.acquire(
      createContext(),
      ['tbl-b', 'tbl-a', 'tbl-a'],
      'shared'
    );

    const lease = leaseResult._unsafeUnwrap();
    expect(coordination.acquireCalls).toEqual([{ tableIds: ['tbl-a', 'tbl-b'], mode: 'shared' }]);
    expect(lease.tableIds).toEqual(['tbl-a', 'tbl-b']);

    await lease.release();
    expect(coordination.releasedTableIds).toEqual([['tbl-a', 'tbl-b']]);
  });

  it('acquires the requested locks on every call', async () => {
    const coordination = new FakeTableSchemaCoordination();
    const context = createContext();

    const first = (await coordination.acquire(context, ['tbl-a'], 'shared'))._unsafeUnwrap();
    const second = (await coordination.acquire(context, ['tbl-a'], 'exclusive'))._unsafeUnwrap();

    expect(coordination.acquireCalls).toEqual([
      { tableIds: ['tbl-a'], mode: 'shared' },
      { tableIds: ['tbl-a'], mode: 'exclusive' },
    ]);
    expect(first).not.toBe(second);
    expect(second.mode).toBe('exclusive');

    await first.release();
    await second.release();
    expect(coordination.releasedTableIds).toEqual([['tbl-a'], ['tbl-a']]);
  });

  it('returns an empty lease without acquiring locks for an empty request', async () => {
    const coordination = new FakeTableSchemaCoordination();

    const lease = (await coordination.acquire(createContext(), [], 'exclusive'))._unsafeUnwrap();

    expect(lease.tableIds).toEqual([]);
    expect(lease.mode).toBe('exclusive');
    expect(coordination.acquireCalls).toEqual([]);
  });
});
