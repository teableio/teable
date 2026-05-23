import { describe, expect, it } from 'vitest';
import { classifyDataDbRuntimeError } from './data-db-runtime-error';

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
});
