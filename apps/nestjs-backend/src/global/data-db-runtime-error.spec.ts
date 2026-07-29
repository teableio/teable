import { describe, expect, it, vi } from 'vitest';
import {
  classifyDataDbRuntimeError,
  handleBestEffortDataDbDropError,
} from './data-db-runtime-error';

describe('classifyDataDbRuntimeError', () => {
  it('classifies a missing external database without echoing the raw driver message', () => {
    const error = Object.assign(new Error('database "customer_deleted_db" does not exist'), {
      code: '3D000',
    });

    expect(classifyDataDbRuntimeError(error)).toMatchObject({
      code: 'data_db.database_missing',
      message: 'The bound data database no longer exists or cannot be selected.',
      retryable: false,
      userActionable: true,
      pgCode: '3D000',
      driverCode: '3D000',
    });
  });

  it('classifies common auth, missing relation, timeout, and pool errors', () => {
    expect(classifyDataDbRuntimeError({ code: '28P01', message: 'password failed' })).toMatchObject(
      {
        code: 'data_db.auth_failed',
        retryable: false,
        userActionable: true,
      }
    );
    expect(
      classifyDataDbRuntimeError({ code: '42P01', message: 'relation missing' })
    ).toMatchObject({
      code: 'data_db.relation_missing',
      retryable: false,
      userActionable: true,
    });
    expect(
      classifyDataDbRuntimeError({ code: 'ETIMEDOUT', message: 'connect timed out' })
    ).toMatchObject({
      code: 'data_db.timeout',
      retryable: true,
      userActionable: true,
      driverCode: 'ETIMEDOUT',
    });
    expect(
      classifyDataDbRuntimeError({ code: 'P2024', message: 'Timed out fetching a new connection' })
    ).toMatchObject({
      code: 'data_db.pool_exhausted',
      retryable: true,
      userActionable: true,
      driverCode: 'P2024',
    });
  });

  it('classifies Prisma messages even when the code is missing', () => {
    expect(
      classifyDataDbRuntimeError(new Error("Can't reach database server at `db.example.com:5432`"))
    ).toMatchObject({
      code: 'data_db.timeout',
      retryable: true,
      userActionable: true,
    });
  });

  it('returns null for unrelated application errors', () => {
    expect(classifyDataDbRuntimeError(new Error('field validation failed'))).toBeNull();
  });

  it('classifies a deleted Supabase tenant as non-retryable even with a network driver code', () => {
    const error = Object.assign(
      new Error('(ENOTFOUND) tenant/user postgres.sztvxsaduujhapiqjtin not found'),
      { code: 'ENOTFOUND' }
    );

    expect(classifyDataDbRuntimeError(error)).toMatchObject({
      code: 'data_db.tenant_missing',
      retryable: false,
      userActionable: true,
    });
    expect(classifyDataDbRuntimeError(new Error('Tenant or user not found'))).toMatchObject({
      code: 'data_db.tenant_missing',
      retryable: false,
    });
  });
});

describe('handleBestEffortDataDbDropError', () => {
  const tenantMissingError = new Error('(ENOTFOUND) tenant/user postgres.abc not found');

  it('swallows non-retryable errors on a bound (BYODB) data database', () => {
    const logger = { warn: vi.fn() };

    expect(() =>
      handleBestEffortDataDbDropError({
        error: tenantMissingError,
        isMetaFallback: false,
        logger,
        target: 'table tblA',
      })
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('data_db.tenant_missing'));
  });

  it('rethrows retryable errors even on a bound data database', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    expect(() =>
      handleBestEffortDataDbDropError({
        error,
        isMetaFallback: false,
        logger: { warn: vi.fn() },
        target: 'table tblA',
      })
    ).toThrow('connect ECONNREFUSED');
  });

  it('rethrows unclassified errors on a bound data database', () => {
    expect(() =>
      handleBestEffortDataDbDropError({
        error: new Error('field validation failed'),
        isMetaFallback: false,
        logger: { warn: vi.fn() },
        target: 'table tblA',
      })
    ).toThrow('field validation failed');
  });

  it('rethrows any error on the platform (meta-fallback) data database', () => {
    expect(() =>
      handleBestEffortDataDbDropError({
        error: tenantMissingError,
        isMetaFallback: true,
        logger: { warn: vi.fn() },
        target: 'table tblA',
      })
    ).toThrow('tenant/user postgres.abc not found');
  });
});
