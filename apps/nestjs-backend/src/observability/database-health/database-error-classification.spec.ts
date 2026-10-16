import { describe, expect, it } from 'vitest';
import type { IDataDbRuntimeErrorClassification } from '../../global/data-db-runtime-error';
import {
  classifyDatabaseError,
  DATABASE_ERROR_CLASSES,
  extractSpanErrorCode,
  type IDatabaseErrorClassification,
} from './database-error-classification';

const byodbs = (
  code: IDataDbRuntimeErrorClassification['code'],
  overrides: Partial<IDataDbRuntimeErrorClassification> = {}
): IDataDbRuntimeErrorClassification => ({
  code,
  message: 'classified',
  retryable: true,
  userActionable: true,
  ...overrides,
});

describe('database error classification', () => {
  it('publishes exactly the contracted error classes', () => {
    expect([...DATABASE_ERROR_CLASSES]).toEqual([
      'timeout',
      'statement_timeout',
      'cancel',
      'deadlock',
      'transaction_aborted',
      'connection_failed',
      'connection_lost',
      'connection_timeout',
      'pool_exhausted',
      'auth_failed',
      'database_missing',
      'schema_missing',
      'object_missing',
      'permission_denied',
      'unique_violation',
      'foreign_key_violation',
      'not_null_violation',
      'data_validation',
      'syntax_error',
      'serialization_failure',
      'other',
      'unclassified',
    ]);
  });

  it.each([
    ['57014', 'canceling statement due to user request', 'cancel'],
    ['57014', 'canceling statement due to statement timeout', 'statement_timeout'],
    ['55P03', 'could not obtain lock', 'deadlock'],
    ['40P01', 'deadlock detected', 'deadlock'],
    ['40001', 'could not serialize access due to concurrent update', 'serialization_failure'],
    ['25P02', 'current transaction is aborted, commands ignored', 'transaction_aborted'],
    ['08006', 'server closed the connection unexpectedly', 'connection_lost'],
    ['57P01', 'terminating connection due to administrator command', 'connection_lost'],
    ['53300', 'sorry, too many clients already', 'pool_exhausted'],
    ['53400', 'configuration limit exceeded', 'pool_exhausted'],
    ['28P01', 'password authentication failed for user "teable"', 'auth_failed'],
    ['28000', 'role "teable" does not exist', 'auth_failed'],
    ['3D000', 'database "teable" does not exist', 'database_missing'],
    ['3F000', 'schema "public" does not exist', 'schema_missing'],
    ['42P01', 'relation "users" does not exist', 'object_missing'],
    ['42501', 'permission denied for table users', 'permission_denied'],
    [
      '23505',
      'duplicate key value violates unique constraint "users_email_key"',
      'unique_violation',
    ],
    [
      '23503',
      'insert or update violates foreign key constraint "fk_base"',
      'foreign_key_violation',
    ],
    ['23502', 'null value in column "name" violates not-null constraint', 'not_null_violation'],
    ['22007', 'invalid datetime format', 'data_validation'],
    ['22008', 'datetime field overflow', 'data_validation'],
    ['22P02', 'invalid input syntax for type integer', 'data_validation'],
    ['42601', 'syntax error at or near "slect"', 'syntax_error'],
    ['42P18', 'indeterminate datatype', 'syntax_error'],
    ['99999', 'something PostgreSQL has not taught us yet', 'other'],
  ])('classifies SQLSTATE %s as %s', (code, message, errorClass) => {
    expect(classifyDatabaseError({ code, message })).toMatchObject({
      errorClass,
      pgCode: code,
    });
  });

  it.each([
    ['ECONNREFUSED', 'connection_failed'],
    ['ECONNRESET', 'connection_lost'],
    ['EPIPE', 'connection_lost'],
    ['ETIMEDOUT', 'connection_timeout'],
    ['ENOTFOUND', 'connection_failed'],
    ['EAI_AGAIN', 'connection_failed'],
    ['ENETUNREACH', 'connection_failed'],
    ['EHOSTUNREACH', 'connection_failed'],
  ])('classifies driver code %s as %s', (code, errorClass) => {
    expect(classifyDatabaseError({ code, message: 'driver failure' })).toMatchObject({
      errorClass,
      driverCode: code,
    });
  });

  it('prefers SQLSTATE over driver codes and over message patterns', () => {
    // Only one `code` can be present, so precedence shows up as: a SQLSTATE is never
    // overridden by a message that looks like a different failure.
    expect(
      classifyDatabaseError({ code: '23505', message: 'syntax error at or near "x"' })
    ).toMatchObject({ errorClass: 'unique_violation', pgCode: '23505' });
    // ...and a node driver code wins over an unrelated message pattern.
    expect(
      classifyDatabaseError({ code: 'ECONNREFUSED', message: 'deadlock detected' })
    ).toMatchObject({ errorClass: 'connection_failed', driverCode: 'ECONNREFUSED' });
  });

  it.each([
    ['timeout exceeded when trying to connect', 'connection_timeout'],
    ['Connection terminated due to connection timeout', 'connection_timeout'],
    ['Connection terminated unexpectedly', 'connection_lost'],
    ['canceling statement due to statement timeout', 'statement_timeout'],
    ['canceling statement due to user request', 'cancel'],
    ['deadlock detected', 'deadlock'],
    [
      'current transaction is aborted, commands ignored until end of transaction block',
      'transaction_aborted',
    ],
    ['sorry, too many clients already', 'pool_exhausted'],
    ['database "teable" does not exist', 'database_missing'],
    ['relation "public.users" does not exist', 'object_missing'],
    ['column "email" does not exist', 'object_missing'],
    ['schema "internal" does not exist', 'schema_missing'],
    ['permission denied for schema public', 'permission_denied'],
    ['duplicate key value violates unique constraint "x"', 'unique_violation'],
    ['update violates foreign key constraint "x"', 'foreign_key_violation'],
    ['null value in column "name" violates not-null constraint', 'not_null_violation'],
    ['invalid input syntax for type uuid: "nope"', 'data_validation'],
    ['value out of range: overflow', 'data_validation'],
    ['invalid text representation', 'data_validation'],
    ['syntax error at or near "slect"', 'syntax_error'],
    ['could not serialize access due to read/write dependencies', 'serialization_failure'],
  ])('classifies the message %s as %s', (message, errorClass) => {
    expect(classifyDatabaseError(new Error(message))).toMatchObject({ errorClass });
  });

  it('reports retryability per class', () => {
    expect(classifyDatabaseError({ code: '08006' }).retryable).toBe(true);
    expect(classifyDatabaseError({ code: '40001' }).retryable).toBe(true);
    expect(classifyDatabaseError({ code: '57014' }).retryable).toBe(false);
    expect(classifyDatabaseError({ code: '23505' }).retryable).toBe(false);
    expect(classifyDatabaseError({ code: '42501' }).retryable).toBe(false);
    expect(classifyDatabaseError(null).retryable).toBe(false);
  });

  it('treats Prisma driver codes as driver codes, not SQLSTATEs', () => {
    const classification = classifyDatabaseError({ code: 'P1001', message: 'unreachable' });

    expect(classification).toMatchObject({ driverCode: 'P1001', errorClass: 'other' });
    expect(classification.pgCode).toBeUndefined();
  });

  it('separates "other" (error text we cannot name) from "unclassified" (no error)', () => {
    expect(classifyDatabaseError(new Error('something odd happened')).errorClass).toBe('other');
    expect(classifyDatabaseError({}).errorClass).toBe('other');
    expect(classifyDatabaseError(null)).toEqual({
      errorClass: 'unclassified',
      retryable: false,
    });
    expect(classifyDatabaseError(undefined)).toEqual({
      errorClass: 'unclassified',
      retryable: false,
    });
    expect(classifyDatabaseError(new Error(''))).toEqual({
      errorClass: 'unclassified',
      retryable: false,
    });
  });

  it('prefers the BYODB verdict when a data-database context classified the error', () => {
    expect(
      classifyDatabaseError(
        { code: '23505', message: 'duplicate key value violates unique constraint "x"' },
        { dataDbClassification: byodbs('data_db.tenant_missing', { retryable: false }) }
      )
    ).toEqual({
      errorClass: 'database_missing',
      retryable: false,
      dataDbCode: 'data_db.tenant_missing',
      pgCode: '23505',
    });

    expect(
      classifyDatabaseError(new Error('connect ETIMEDOUT'), {
        dataDbClassification: byodbs('data_db.connection_refused', { retryable: true }),
      })
    ).toMatchObject({
      errorClass: 'connection_failed',
      retryable: true,
      dataDbCode: 'data_db.connection_refused',
    });

    // A null verdict (the classifier found nothing BYODB-specific) falls back to the chain.
    expect(classifyDatabaseError({ code: '23505' }, { dataDbClassification: null })).toMatchObject({
      errorClass: 'unique_violation',
    });
  });

  it('reads the SQLSTATE pg embeds in its sanitized span exception message', () => {
    expect(
      extractSpanErrorCode("PostgreSQL error of type 'PostgreSQLError' occurred (code: 57014)")
    ).toBe('57014');
    expect(
      extractSpanErrorCode("PostgreSQL error of type 'PostgreSQLError' occurred (code: UNKNOWN)")
    ).toBeUndefined();
    expect(extractSpanErrorCode(undefined)).toBeUndefined();
  });

  it('classifies span-shaped errors through the extracted SQLSTATE', () => {
    const classification: IDatabaseErrorClassification = classifyDatabaseError({
      code: extractSpanErrorCode(
        "PostgreSQL error of type 'PostgreSQLError' occurred (code: 3D000)"
      ),
      message: 'sanitized',
    });

    expect(classification.errorClass).toBe('database_missing');
  });
});
