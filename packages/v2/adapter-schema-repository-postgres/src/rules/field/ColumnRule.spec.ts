import type { Field } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { SchemaIntrospector } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import { ColumnRule } from './ColumnRule';

// Create mock field with proper FieldType implementation
const createMockField = (id: string, dbFieldName: string): Field =>
  ({
    id: () => ({ toString: () => id }),
    type: () => ({
      toString: () => 'singleLineText',
      equals: () => false, // Not formula, rollup, or any special type
    }),
    computed: () => ({ toBoolean: () => false }),
    notNull: () => ({ toBoolean: () => false }),
    unique: () => ({ toBoolean: () => false }),
    dbFieldName: () =>
      ok({
        value: () => ok(dbFieldName),
      }),
  }) as unknown as Field;

// Create mock introspector
const createMockIntrospector = (columnExists: boolean): SchemaIntrospector =>
  ({
    columnExists: vi.fn().mockResolvedValue(ok(columnExists)),
    getColumn: vi
      .fn()
      .mockResolvedValue(
        ok(
          columnExists
            ? { columnName: 'fld_test', dataType: 'text', isNullable: true, isGenerated: false }
            : null
        )
      ),
    indexExists: vi.fn().mockResolvedValue(ok(false)),
    getIndex: vi.fn().mockResolvedValue(ok(null)),
    foreignKeyExists: vi.fn().mockResolvedValue(ok(false)),
    getForeignKey: vi.fn().mockResolvedValue(ok(null)),
    tableExists: vi.fn().mockResolvedValue(ok(false)),
    constraintExists: vi.fn().mockResolvedValue(ok(false)),
  }) as unknown as SchemaIntrospector;

// Create mock db
const createMockDb = (): Kysely<V1TeableDatabase> =>
  ({
    schema: {
      withSchema: vi.fn().mockReturnThis(),
      alterTable: vi.fn().mockReturnValue({
        addColumn: vi.fn().mockReturnValue({
          compile: () => ({ sql: 'ALTER TABLE ...', parameters: [] }),
        }),
      }),
    },
  }) as unknown as Kysely<V1TeableDatabase>;

describe('ColumnRule', () => {
  it('should have correct id format', () => {
    const rule = new ColumnRule('fldTest123', 'Test Field', 'text');
    expect(rule.id).toBe('column:fldTest123');
  });

  it('should have no dependencies', () => {
    const rule = new ColumnRule('fldTest123', 'Test Field', 'text');
    expect(rule.dependencies).toEqual([]);
  });

  it('should be required', () => {
    const rule = new ColumnRule('fldTest123', 'Test Field', 'text');
    expect(rule.required).toBe(true);
  });

  it('should have correct description', () => {
    const rule = new ColumnRule('fldTest123', 'Test Field', 'text', { notNull: true });
    expect(rule.description).toBe('Physical column "Test Field" (text, NOT NULL)');
  });

  describe('isValid', () => {
    it('should return valid:true when column exists', async () => {
      const rule = new ColumnRule('fldTest123', 'Test Field', 'text');
      const ctx: SchemaRuleContext = {
        db: createMockDb(),
        introspector: createMockIntrospector(true),
        schema: 'test_schema',
        tableName: 'test_table',
        tableId: 'tblTest',
        field: createMockField('fldTest123', 'fld_test'),
      };

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('should return valid:false with missing info when column does not exist', async () => {
      const rule = new ColumnRule('fldTest123', 'Test Field', 'text');
      const ctx: SchemaRuleContext = {
        db: createMockDb(),
        introspector: createMockIntrospector(false),
        schema: 'test_schema',
        tableName: 'test_table',
        tableId: 'tblTest',
        field: createMockField('fldTest123', 'fld_test'),
      };

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.length).toBeGreaterThan(0);
    });
  });

  describe('up', () => {
    it('should generate add column statement', () => {
      const rule = new ColumnRule('fldTest123', 'Test Field', 'text');
      const mockDb = createMockDb();
      const ctx: SchemaRuleContext = {
        db: mockDb,
        introspector: createMockIntrospector(false),
        schema: 'test_schema',
        tableName: 'test_table',
        tableId: 'tblTest',
        field: createMockField('fldTest123', 'fld_test'),
      };

      const result = rule.up(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().length).toBe(1);
    });
  });

  describe('down', () => {
    it('should generate drop column statement', () => {
      const rule = new ColumnRule('fldTest123', 'Test Field', 'text');
      const ctx: SchemaRuleContext = {
        db: createMockDb(),
        introspector: createMockIntrospector(true),
        schema: 'test_schema',
        tableName: 'test_table',
        tableId: 'tblTest',
        field: createMockField('fldTest123', 'fld_test'),
      };

      const result = rule.down(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().length).toBe(1);
    });
  });
});
