import { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { v2PostgresStateAdapterConfigSchema } from './config';

describe('v2PostgresStateAdapterConfigSchema', () => {
  it('accepts a duck-typed Kysely instance and applies defaults', () => {
    const db = {
      selectFrom: vi.fn(),
      insertInto: vi.fn(),
      updateTable: vi.fn(),
      deleteFrom: vi.fn(),
    };

    const result = v2PostgresStateAdapterConfigSchema.parse({
      db,
      maxFreeRowLimit: '12',
    });

    expect(result.db).toBe(db);
    expect(result.maxFreeRowLimit).toBe(12);
    expect(result.ensureSchema).toBeUndefined();
    expect(result.seed).toEqual({
      spaceId: 'spc_default',
      baseId: 'bse_default',
      actorId: 'system',
    });
  });

  it('accepts values that inherit from Kysely', () => {
    const db = Object.create(Kysely.prototype);

    const result = v2PostgresStateAdapterConfigSchema.safeParse({
      db,
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid database instances', () => {
    const result = v2PostgresStateAdapterConfigSchema.safeParse({
      db: null,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Invalid Kysely database instance');
    }
  });

  it('allows overriding the default seed values', () => {
    const db = {
      selectFrom: vi.fn(),
      insertInto: vi.fn(),
      updateTable: vi.fn(),
      deleteFrom: vi.fn(),
    };

    const result = v2PostgresStateAdapterConfigSchema.parse({
      db,
      seed: {
        spaceId: 'spc_custom',
        baseId: 'bse_custom',
        actorId: 'usr_custom',
      },
    });

    expect(result.seed).toEqual({
      spaceId: 'spc_custom',
      baseId: 'bse_custom',
      actorId: 'usr_custom',
    });
  });
});
