import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { PostgresUserLookupService } from './PostgresUserLookupService';

const createExpressionBuilder = () =>
  Object.assign(
    ((column: string, op: string, value: unknown) => ({ column, op, value })) as (
      column: string,
      op: string,
      value: unknown
    ) => unknown,
    {
      or: (conditions: unknown[]) => ({ conditions }),
    }
  );

describe('PostgresUserLookupService', () => {
  it('returns early when there are no identifiers to lookup', async () => {
    const db = {
      selectFrom: vi.fn(),
    } as unknown as Kysely<unknown>;
    const service = new PostgresUserLookupService(db as never);

    const result = await service.listUsersByIdentifiers(['', '', '']);

    expect(result._unsafeUnwrap()).toEqual([]);
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it('deduplicates identifiers, builds the OR query, and maps rows', async () => {
    const conditions: Array<{ column: string; op: string; value: unknown }> = [];
    const eb = Object.assign(createExpressionBuilder(), {
      or: (clauses: Array<{ column: string; op: string; value: unknown }>) => {
        conditions.push(...clauses);
        return { clauses };
      },
    });

    const execute = vi.fn(async () => [
      { id: 'usr1', name: 'Alice', email: 'alice@example.com' },
      { id: 'usr2', name: 'Bob', email: null },
    ]);
    const where = vi.fn((callback: (builder: typeof eb) => unknown) => {
      callback(eb);
      return { execute };
    });
    const select = vi.fn(() => ({ where }));
    const db = {
      selectFrom: vi.fn(() => ({ select })),
    } as unknown as Kysely<unknown>;
    const service = new PostgresUserLookupService(db as never);

    const result = await service.listUsersByIdentifiers([
      'usr1',
      'alice@example.com',
      'usr1',
      'Alice',
    ]);

    expect(result._unsafeUnwrap()).toEqual([
      { id: 'usr1', name: 'Alice', email: 'alice@example.com' },
      { id: 'usr2', name: 'Bob', email: null },
    ]);
    expect(conditions).toEqual([
      { column: 'id', op: 'in', value: ['usr1', 'alice@example.com', 'Alice'] },
      { column: 'email', op: 'in', value: ['usr1', 'alice@example.com', 'Alice'] },
      { column: 'name', op: 'in', value: ['usr1', 'alice@example.com', 'Alice'] },
    ]);
  });

  it('wraps lookup failures as infrastructure errors', async () => {
    const where = vi.fn(() => ({
      execute: async () => {
        throw new Error('users query failed');
      },
    }));
    const select = vi.fn(() => ({ where }));
    const db = {
      selectFrom: vi.fn(() => ({ select })),
    } as unknown as Kysely<unknown>;
    const service = new PostgresUserLookupService(db as never);

    const result = await service.listUsersByIdentifiers(['usr1']);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      tags: ['infrastructure'],
      message: 'Failed to lookup users',
    });
  });
});
