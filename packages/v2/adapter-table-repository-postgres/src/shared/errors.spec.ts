import { describe, expect, it } from 'vitest';
import {
  describeError,
  isLinkUniqueViolation,
  isNotNullViolation,
  isUniqueViolation,
  PG_NOT_NULL_VIOLATION,
  PG_UNIQUE_VIOLATION,
  wrapDatabaseError,
} from './errors';

describe('PostgreSQL error utilities', () => {
  describe('describeError', () => {
    it('returns message for DomainError-like objects', () => {
      const domainError = {
        code: 'test.error',
        message: 'Test error message',
        tags: ['validation'],
      };
      expect(describeError(domainError)).toBe('Test error message');
    });

    it('returns formatted message for Error instances', () => {
      const error = new Error('Something went wrong');
      expect(describeError(error)).toBe('Error: Something went wrong');
    });

    it('returns error name when message is empty', () => {
      const error = new TypeError();
      error.message = '';
      expect(describeError(error)).toBe('TypeError');
    });

    it('returns string as-is', () => {
      expect(describeError('plain string error')).toBe('plain string error');
    });

    it('returns JSON stringified object', () => {
      const obj = { foo: 'bar', count: 42 };
      expect(describeError(obj)).toBe('{"foo":"bar","count":42}');
    });

    it('returns String(value) for non-stringifiable objects', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(describeError(circular)).toBe('[object Object]');
    });
  });

  describe('isUniqueViolation', () => {
    it('returns true for PostgreSQL unique violation error code', () => {
      const pgError = { code: PG_UNIQUE_VIOLATION };
      expect(isUniqueViolation(pgError)).toBe(true);
    });

    it('returns false for other error codes', () => {
      const pgError = { code: '23503' }; // foreign key violation
      expect(isUniqueViolation(pgError)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isUniqueViolation(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isUniqueViolation('string')).toBe(false);
    });

    it('returns false for object without code property', () => {
      expect(isUniqueViolation({ message: 'error' })).toBe(false);
    });
  });

  describe('isNotNullViolation', () => {
    it('returns true for PostgreSQL not-null violation error code', () => {
      const pgError = { code: PG_NOT_NULL_VIOLATION };
      expect(isNotNullViolation(pgError)).toBe(true);
    });

    it('returns false for other error codes', () => {
      const pgError = { code: PG_UNIQUE_VIOLATION };
      expect(isNotNullViolation(pgError)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isNotNullViolation(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isNotNullViolation(123)).toBe(false);
    });
  });

  describe('isLinkUniqueViolation', () => {
    it('returns true for unique violation with __fk_fld in constraint name', () => {
      const pgError = {
        code: PG_UNIQUE_VIOLATION,
        constraint: 'index___fk_fld123abc',
      };
      expect(isLinkUniqueViolation(pgError)).toBe(true);
    });

    it('returns true for unique violation with fk_fld in constraint name', () => {
      const pgError = {
        code: PG_UNIQUE_VIOLATION,
        constraint: 'some_table_fk_fld456def_unique',
      };
      expect(isLinkUniqueViolation(pgError)).toBe(true);
    });

    it('returns true when constraint is in message instead of constraint field', () => {
      const pgError = {
        code: PG_UNIQUE_VIOLATION,
        message: 'duplicate key violates unique constraint "index___fk_fldxyz"',
      };
      expect(isLinkUniqueViolation(pgError)).toBe(true);
    });

    it('returns false for unique violation on non-link field', () => {
      const pgError = {
        code: PG_UNIQUE_VIOLATION,
        constraint: 'users_email_unique',
      };
      expect(isLinkUniqueViolation(pgError)).toBe(false);
    });

    it('returns false for non-unique violation error', () => {
      const pgError = {
        code: PG_NOT_NULL_VIOLATION,
        constraint: '__fk_fld123',
      };
      expect(isLinkUniqueViolation(pgError)).toBe(false);
    });
  });

  describe('wrapDatabaseError', () => {
    const tableName = 'test_table';
    const recordId = 'rec123';

    describe('insert operation', () => {
      it('wraps not-null violation as validation error', () => {
        const pgError = { code: PG_NOT_NULL_VIOLATION };
        const result = wrapDatabaseError(pgError, 'insert', { tableName });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.field.not_null');
        expect(result.message).toBe(
          'Cannot complete insert: null value violates not-null constraint'
        );
      });

      it('wraps unique violation as validation error', () => {
        const pgError = { code: PG_UNIQUE_VIOLATION, constraint: 'users_email_unique' };
        const result = wrapDatabaseError(pgError, 'insert', { tableName });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.field.unique');
        expect(result.message).toBe('Cannot complete insert: unique constraint violated');
      });

      it('wraps link unique violation with specific message', () => {
        const pgError = { code: PG_UNIQUE_VIOLATION, constraint: 'index___fk_fld123' };
        const result = wrapDatabaseError(pgError, 'insert', { tableName });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.link.one_one_duplicate');
        expect(result.message).toContain('one-to-one relationship');
      });

      it('wraps unknown error as infrastructure error', () => {
        const error = new Error('Connection timeout');
        const result = wrapDatabaseError(error, 'insert', { tableName });

        expect(result.tags).toContain('infrastructure');
        expect(result.code).toBe('infrastructure.database.insert_failed');
        expect(result.message).toContain('Connection timeout');
        expect(result.details).toEqual({
          tableName,
          error: 'Error: Connection timeout',
        });
      });
    });

    describe('update operation', () => {
      it('wraps not-null violation as validation error', () => {
        const pgError = { code: PG_NOT_NULL_VIOLATION };
        const result = wrapDatabaseError(pgError, 'update', { tableName, recordId });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.field.not_null');
        expect(result.message).toBe(
          'Cannot complete update: null value violates not-null constraint'
        );
      });

      it('wraps unique violation as validation error', () => {
        const pgError = { code: PG_UNIQUE_VIOLATION, constraint: 'users_email_unique' };
        const result = wrapDatabaseError(pgError, 'update', { tableName, recordId });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.field.unique');
        expect(result.message).toBe('Cannot complete update: unique constraint violated');
      });

      it('includes recordId in infrastructure error details', () => {
        const error = new Error('Database error');
        const result = wrapDatabaseError(error, 'update', { tableName, recordId });

        expect(result.details).toEqual({
          tableName,
          recordId,
          error: 'Error: Database error',
        });
      });
    });

    describe('delete operation', () => {
      it('wraps unknown error as infrastructure error with count', () => {
        const error = new Error('Foreign key constraint');
        const result = wrapDatabaseError(error, 'delete', { tableName, count: 5 });

        expect(result.tags).toContain('infrastructure');
        expect(result.code).toBe('infrastructure.database.delete_failed');
        expect(result.message).toContain('Failed to delete records');
        expect(result.details).toEqual({
          tableName,
          count: 5,
          error: 'Error: Foreign key constraint',
        });
      });

      it('uses singular "record" when count is not provided', () => {
        const error = new Error('Database error');
        const result = wrapDatabaseError(error, 'delete', { tableName });

        expect(result.message).toContain('Failed to delete record:');
      });
    });
  });
});
