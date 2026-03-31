import type { Field } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import {
  describeError,
  extractNotNullColumn,
  extractUniqueColumn,
  isLinkUniqueViolation,
  isNotNullViolation,
  isUniqueViolation,
  PG_NOT_NULL_VIOLATION,
  PG_UNIQUE_VIOLATION,
  wrapDatabaseError,
} from './errors';

/** Minimal Field-like stub for testing wrapDatabaseError field resolution. */
const stubField = (fieldId: string, fieldName: string, dbColumn: string): Field =>
  ({
    id: () => ({ toString: () => fieldId }),
    name: () => ({ toString: () => fieldName }),
    dbFieldName: () => ok({ value: () => ok(dbColumn) }),
  }) as unknown as Field;

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

  describe('extractNotNullColumn', () => {
    it('extracts column name from PG error with column property', () => {
      expect(extractNotNullColumn({ code: PG_NOT_NULL_VIOLATION, column: 'fld_abc123' })).toBe(
        'fld_abc123'
      );
    });

    it('returns undefined when column is missing', () => {
      expect(extractNotNullColumn({ code: PG_NOT_NULL_VIOLATION })).toBeUndefined();
    });

    it('returns undefined for non-object', () => {
      expect(extractNotNullColumn('string')).toBeUndefined();
    });

    it('returns undefined for empty column string', () => {
      expect(extractNotNullColumn({ column: '' })).toBeUndefined();
    });
  });

  describe('extractUniqueColumn', () => {
    it('extracts column name from constraint following tableName_columnName_unique pattern', () => {
      expect(
        extractUniqueColumn(
          { code: PG_UNIQUE_VIOLATION, constraint: 'test_table_fld_abc123_unique' },
          'test_table'
        )
      ).toBe('fld_abc123');
    });

    it('returns undefined when constraint does not match pattern', () => {
      expect(
        extractUniqueColumn(
          { code: PG_UNIQUE_VIOLATION, constraint: 'other_constraint_name' },
          'test_table'
        )
      ).toBeUndefined();
    });

    it('returns undefined when constraint property is missing', () => {
      expect(extractUniqueColumn({ code: PG_UNIQUE_VIOLATION }, 'test_table')).toBeUndefined();
    });

    it('returns undefined for non-object', () => {
      expect(extractUniqueColumn(null, 'test_table')).toBeUndefined();
    });

    it('handles schema-qualified table name', () => {
      expect(
        extractUniqueColumn(
          { code: PG_UNIQUE_VIOLATION, constraint: 'tblAbc123_Ge_Ren_Zhu_Ye_unique' },
          'bseSchema.tblAbc123'
        )
      ).toBe('Ge_Ren_Zhu_Ye');
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
        expect(result.message).toBe('Cannot complete insert: field  cannot be empty');
      });

      it('wraps unique violation as validation error', () => {
        const pgError = { code: PG_UNIQUE_VIOLATION, constraint: 'users_email_unique' };
        const result = wrapDatabaseError(pgError, 'insert', { tableName });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.field.unique');
        expect(result.message).toBe('Cannot complete insert: field  must have a unique value');
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
        expect(result.message).toBe('Cannot complete update: field  cannot be empty');
      });

      it('wraps unique violation as validation error', () => {
        const pgError = { code: PG_UNIQUE_VIOLATION, constraint: 'users_email_unique' };
        const result = wrapDatabaseError(pgError, 'update', { tableName, recordId });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.field.unique');
        expect(result.message).toBe('Cannot complete update: field  must have a unique value');
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

    describe('query operation', () => {
      it('uses query-specific infrastructure error metadata for read failures', () => {
        const error = new Error('Read timeout');
        const result = wrapDatabaseError(error, 'query', { tableName, recordId });

        expect(result.tags).toContain('infrastructure');
        expect(result.code).toBe('infrastructure.database.query_failed');
        expect(result.message).toContain('Failed to query record');
        expect(result.details).toEqual({
          tableName,
          recordId,
          error: 'Error: Read timeout',
        });
      });
    });

    describe('field info enrichment', () => {
      const fields = [
        stubField('fldAbc123', 'Email Address', 'fld_email'),
        stubField('fldDef456', 'Required Field', 'fld_required'),
      ];

      it('includes fieldId in message and fieldName in details for unique violation', () => {
        const pgError = {
          code: PG_UNIQUE_VIOLATION,
          constraint: 'test_table_fld_email_unique',
        };
        const result = wrapDatabaseError(pgError, 'insert', {
          tableName,
          fields,
        });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.field.unique');
        expect(result.message).toBe(
          'Cannot complete insert: field fldAbc123 must have a unique value'
        );
        expect(result.details).toEqual({ fieldId: 'fldAbc123', fieldName: 'Email Address' });
      });

      it('includes fieldId in message and fieldName in details for not-null violation', () => {
        const pgError = {
          code: PG_NOT_NULL_VIOLATION,
          column: 'fld_required',
        };
        const result = wrapDatabaseError(pgError, 'insert', {
          tableName,
          fields,
        });

        expect(result.tags).toContain('validation');
        expect(result.code).toBe('validation.field.not_null');
        expect(result.message).toBe('Cannot complete insert: field fldDef456 cannot be empty');
        expect(result.details).toEqual({ fieldId: 'fldDef456', fieldName: 'Required Field' });
      });

      it('falls back to generic unique message when column not in fields', () => {
        const pgError = {
          code: PG_UNIQUE_VIOLATION,
          constraint: 'test_table_fld_unknown_unique',
        };
        const result = wrapDatabaseError(pgError, 'insert', {
          tableName,
          fields,
        });

        expect(result.message).toBe('Cannot complete insert: field  must have a unique value');
        expect(result.details).toBeUndefined();
      });

      it('falls back to generic not-null message when column not in fields', () => {
        const pgError = {
          code: PG_NOT_NULL_VIOLATION,
          column: 'fld_unknown',
        };
        const result = wrapDatabaseError(pgError, 'insert', {
          tableName,
          fields,
        });

        expect(result.message).toBe('Cannot complete insert: field  cannot be empty');
        expect(result.details).toBeUndefined();
      });

      it('falls back to generic messages when fields is not provided', () => {
        const uniqueError = {
          code: PG_UNIQUE_VIOLATION,
          constraint: 'test_table_fld_email_unique',
        };
        const notNullError = { code: PG_NOT_NULL_VIOLATION, column: 'fld_required' };

        const uniqueResult = wrapDatabaseError(uniqueError, 'update', { tableName });
        expect(uniqueResult.message).toBe(
          'Cannot complete update: field  must have a unique value'
        );

        const notNullResult = wrapDatabaseError(notNullError, 'update', { tableName });
        expect(notNullResult.message).toBe('Cannot complete update: field  cannot be empty');
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
