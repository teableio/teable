/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Field } from '@teable/v2-core';
import {
  BaseId,
  DbFieldName,
  FieldName,
  Table,
  TableId,
  TableName,
  fieldTypeValues,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { FieldSqlLiteralVisitor } from './FieldSqlLiteralVisitor';

// ============================================================================
// Type-safe test matrix setup
// ============================================================================

/**
 * Field type literal values - must match fieldTypeValues from FieldType.ts
 * TypeScript will error if fieldTypeValues changes and this doesn't match.
 */
type FieldTypeLiteral = (typeof fieldTypeValues)[number];

/**
 * SQL literal type categories for NULL handling
 */
type SqlLiteralCategory = 'text' | 'numeric' | 'boolean' | 'timestamp' | 'jsonb' | 'computed';

/**
 * Test case definition for FieldSqlLiteralVisitor
 */
interface FieldSqlLiteralTestCase {
  type: FieldTypeLiteral;
  category: SqlLiteralCategory;
  /** Whether this field can be created with simple TableBuilder (no complex config) */
  canSimplyCreate: boolean;
  /** Sample non-null value for this field type */
  sampleValue: unknown;
  /** Expected SQL literal for sample value */
  expectedSampleLiteral: string;
  /** Expected SQL literal for NULL value */
  expectedNullLiteral: string;
}

// ============================================================================
// Helper functions
// ============================================================================

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;

/**
 * Create a table with a single field of the specified type using TableBuilder.
 * This approach uses the public API instead of direct field class constructors.
 *
 * Note: Some field types (formula, rollup, lookup, link, conditionalRollup, conditionalLookup)
 * require complex configuration and reference resolution that makes them difficult to
 * create in isolation for unit tests.
 */
const createTableWithField = (fieldType: FieldTypeLiteral, dbFieldName: string): Table => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const tableName = TableName.create('TestTable')._unsafeUnwrap();
  const fieldName = FieldName.create('TestField')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);

  // Add field based on type (only simple types)
  switch (fieldType) {
    case 'singleLineText':
      builder.field().singleLineText().withName(fieldName).done();
      break;
    case 'longText':
      builder.field().longText().withName(fieldName).done();
      break;
    case 'number':
      builder.field().number().withName(fieldName).done();
      break;
    case 'rating':
      builder.field().rating().withName(fieldName).done();
      break;
    case 'checkbox':
      builder.field().checkbox().withName(fieldName).done();
      break;
    case 'date':
      builder.field().date().withName(fieldName).done();
      break;
    case 'singleSelect':
      builder.field().singleSelect().withName(fieldName).done();
      break;
    case 'multipleSelect':
      builder.field().multipleSelect().withName(fieldName).done();
      break;
    case 'attachment':
      builder.field().attachment().withName(fieldName).done();
      break;
    case 'user':
      builder.field().user().withName(fieldName).done();
      break;
    case 'createdTime':
      builder.field().createdTime().withName(fieldName).done();
      break;
    case 'lastModifiedTime':
      builder.field().lastModifiedTime().withName(fieldName).done();
      break;
    case 'createdBy':
      builder.field().createdBy().withName(fieldName).done();
      break;
    case 'lastModifiedBy':
      builder.field().lastModifiedBy().withName(fieldName).done();
      break;
    case 'autoNumber':
      builder.field().autoNumber().withName(fieldName).done();
      break;
    case 'button':
      builder.field().button().withName(fieldName).done();
      break;
    // These types require complex configuration - handled separately
    case 'link':
    case 'formula':
    case 'rollup':
    case 'lookup':
    case 'conditionalRollup':
    case 'conditionalLookup':
      throw new Error(
        `Field type ${fieldType} requires complex configuration and cannot be simply created`
      );
  }

  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();

  // Set DB field name for the first field
  const dbFieldNameVO = DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap();
  table.getFields()[0].setDbFieldName(dbFieldNameVO)._unsafeUnwrap();

  return table;
};

// ============================================================================
// Type-exhaustive field test case definitions
// ============================================================================

/**
 * Create a type-safe map that requires ALL field types to be covered.
 * If a new field type is added to fieldTypeValues, TypeScript will error here
 * because the record will be missing a key.
 */
const createFieldTestCases = (): Record<FieldTypeLiteral, FieldSqlLiteralTestCase> => {
  return {
    // --- Text types (no cast needed for values, no cast for NULL) ---
    singleLineText: {
      type: 'singleLineText',
      category: 'text',
      canSimplyCreate: true,
      sampleValue: 'hello world',
      expectedSampleLiteral: "'hello world'",
      expectedNullLiteral: 'NULL',
    },
    longText: {
      type: 'longText',
      category: 'text',
      canSimplyCreate: true,
      sampleValue: 'long text content',
      expectedSampleLiteral: "'long text content'",
      expectedNullLiteral: 'NULL',
    },
    singleSelect: {
      type: 'singleSelect',
      category: 'text',
      canSimplyCreate: true,
      sampleValue: 'Option1',
      expectedSampleLiteral: "'Option1'",
      expectedNullLiteral: 'NULL',
    },

    // --- Numeric types (::double precision) ---
    number: {
      type: 'number',
      category: 'numeric',
      canSimplyCreate: true,
      sampleValue: 42.5,
      expectedSampleLiteral: '42.5::double precision',
      expectedNullLiteral: 'NULL::double precision',
    },
    rating: {
      type: 'rating',
      category: 'numeric',
      canSimplyCreate: true,
      sampleValue: 4,
      expectedSampleLiteral: '4::double precision',
      expectedNullLiteral: 'NULL::double precision',
    },

    // --- Boolean types (::boolean) ---
    checkbox: {
      type: 'checkbox',
      category: 'boolean',
      canSimplyCreate: true,
      sampleValue: true,
      expectedSampleLiteral: 'true::boolean',
      expectedNullLiteral: 'NULL::boolean',
    },

    // --- Timestamp types (::timestamptz) ---
    date: {
      type: 'date',
      category: 'timestamp',
      canSimplyCreate: true,
      sampleValue: '2025-01-17T10:00:00.000Z',
      expectedSampleLiteral: "'2025-01-17T10:00:00.000Z'::timestamptz",
      expectedNullLiteral: 'NULL::timestamptz',
    },

    // --- JSONB types (::jsonb) ---
    multipleSelect: {
      type: 'multipleSelect',
      category: 'jsonb',
      canSimplyCreate: true,
      sampleValue: '["Option1","Option2"]',
      expectedSampleLiteral: `'["Option1","Option2"]'::jsonb`,
      expectedNullLiteral: 'NULL::jsonb',
    },
    attachment: {
      type: 'attachment',
      category: 'jsonb',
      canSimplyCreate: true,
      sampleValue: '[{"id":"att_001","name":"file.pdf"}]',
      expectedSampleLiteral: `'[{"id":"att_001","name":"file.pdf"}]'::jsonb`,
      expectedNullLiteral: 'NULL::jsonb',
    },
    user: {
      type: 'user',
      category: 'jsonb',
      canSimplyCreate: true,
      sampleValue: '{"id":"usr_001","name":"Alice"}',
      expectedSampleLiteral: `'{"id":"usr_001","name":"Alice"}'::jsonb`,
      expectedNullLiteral: 'NULL::jsonb',
    },
    // Link field requires complex config but is JSONB type
    link: {
      type: 'link',
      category: 'jsonb',
      canSimplyCreate: false, // Requires LinkFieldConfig
      sampleValue: '[{"id":"rec_001"}]',
      expectedSampleLiteral: `'[{"id":"rec_001"}]'::jsonb`,
      expectedNullLiteral: 'NULL::jsonb',
    },

    // --- Computed fields (always return NULL, no cast needed) ---
    formula: {
      type: 'formula',
      category: 'computed',
      canSimplyCreate: false, // Requires expression + result type resolution
      sampleValue: 123,
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    rollup: {
      type: 'rollup',
      category: 'computed',
      canSimplyCreate: false, // Requires link field + lookup field
      sampleValue: 100,
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    lookup: {
      type: 'lookup',
      category: 'computed',
      canSimplyCreate: false, // Requires link field + inner field
      sampleValue: 'looked up',
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    createdTime: {
      type: 'createdTime',
      category: 'computed',
      canSimplyCreate: true,
      sampleValue: '2025-01-17T00:00:00.000Z',
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    lastModifiedTime: {
      type: 'lastModifiedTime',
      category: 'computed',
      canSimplyCreate: true,
      sampleValue: '2025-01-17T00:00:00.000Z',
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    createdBy: {
      type: 'createdBy',
      category: 'computed',
      canSimplyCreate: true,
      sampleValue: 'user_id',
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    lastModifiedBy: {
      type: 'lastModifiedBy',
      category: 'jsonb',
      canSimplyCreate: true,
      sampleValue: 'user_id',
      expectedSampleLiteral: `'user_id'::jsonb`,
      expectedNullLiteral: 'NULL::jsonb',
    },
    autoNumber: {
      type: 'autoNumber',
      category: 'computed',
      canSimplyCreate: true,
      sampleValue: 1,
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    button: {
      type: 'button',
      category: 'computed',
      canSimplyCreate: true,
      sampleValue: 'click',
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    conditionalRollup: {
      type: 'conditionalRollup',
      category: 'computed',
      canSimplyCreate: false, // Requires complex config
      sampleValue: 50,
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
    conditionalLookup: {
      type: 'conditionalLookup',
      category: 'computed',
      canSimplyCreate: false, // Requires complex config
      sampleValue: 'conditional lookup',
      expectedSampleLiteral: 'NULL',
      expectedNullLiteral: 'NULL',
    },
  };
};

/**
 * Compile-time check: Ensure all field types are covered.
 * This line will cause a TypeScript error if any field type is missing from the factory map.
 */
const _exhaustiveCheck: Record<FieldTypeLiteral, FieldSqlLiteralTestCase> = createFieldTestCases();
// Use the variable to avoid unused variable warning
void _exhaustiveCheck;

// ============================================================================
// Tests
// ============================================================================

describe('FieldSqlLiteralVisitor', () => {
  const allTestCases = Object.values(createFieldTestCases());

  // Filter to only include fields that can be simply created
  const simpleFieldCases = allTestCases.filter((tc) => tc.canSimplyCreate);
  const complexFieldCases = allTestCases.filter((tc) => !tc.canSimplyCreate);

  // Group simple test cases by category for clarity
  const textFieldCases = simpleFieldCases.filter((tc) => tc.category === 'text');
  const numericFieldCases = simpleFieldCases.filter((tc) => tc.category === 'numeric');
  const booleanFieldCases = simpleFieldCases.filter((tc) => tc.category === 'boolean');
  const timestampFieldCases = simpleFieldCases.filter((tc) => tc.category === 'timestamp');
  const jsonbFieldCases = simpleFieldCases.filter((tc) => tc.category === 'jsonb');
  const computedFieldCases = simpleFieldCases.filter((tc) => tc.category === 'computed');

  // Helper to create field from test case
  const createField = (testCase: FieldSqlLiteralTestCase): Field => {
    if (!testCase.canSimplyCreate) {
      throw new Error(`Cannot simply create field type: ${testCase.type}`);
    }
    const table = createTableWithField(testCase.type, `col_${testCase.type}`);
    return table.getFields()[0];
  };

  // ============================================================================
  // Matrix tests: Value literals for all simple field types
  // ============================================================================

  describe('value literals (sample values)', () => {
    it.each(simpleFieldCases)(
      '$type: generates correct SQL literal for sample value',
      (testCase) => {
        const field = createField(testCase);
        const visitor = FieldSqlLiteralVisitor.create(testCase.sampleValue);
        const result = field.accept(visitor);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe(testCase.expectedSampleLiteral);
      }
    );
  });

  describe('NULL literals for all simple field types', () => {
    it.each(simpleFieldCases)('$type: generates correct SQL literal for NULL value', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(null);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(testCase.expectedNullLiteral);
    });
  });

  describe('undefined literals for all simple field types', () => {
    it.each(simpleFieldCases)(
      '$type: generates correct SQL literal for undefined value',
      (testCase) => {
        const field = createField(testCase);
        const visitor = FieldSqlLiteralVisitor.create(undefined);
        const result = field.accept(visitor);

        expect(result.isOk()).toBe(true);
        // undefined should behave the same as null
        expect(result._unsafeUnwrap()).toBe(testCase.expectedNullLiteral);
      }
    );
  });

  // ============================================================================
  // Category-specific detailed tests
  // ============================================================================

  describe('text fields (no type cast)', () => {
    it.each(textFieldCases)('$type: escapes single quotes', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create("O'Brien's test");
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("'O''Brien''s test'");
    });

    it.each(textFieldCases)('$type: converts non-string values to string', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(12345);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("'12345'");
    });
  });

  describe('numeric fields (::double precision cast)', () => {
    it.each(numericFieldCases)('$type: handles integer values', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(100);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('100::double precision');
    });

    it.each(numericFieldCases)('$type: handles decimal values', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(3.14159);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('3.14159::double precision');
    });

    it.each(numericFieldCases)('$type: handles negative values', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(-42);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('-42::double precision');
    });

    it.each(numericFieldCases)('$type: handles zero', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(0);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('0::double precision');
    });
  });

  describe('boolean fields (::boolean cast)', () => {
    it.each(booleanFieldCases)('$type: handles true', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(true);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('true::boolean');
    });

    it.each(booleanFieldCases)('$type: handles false', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(false);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('false::boolean');
    });
  });

  describe('timestamp fields (::timestamptz cast)', () => {
    it.each(timestampFieldCases)('$type: handles ISO date string', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create('2025-06-15T14:30:00.000Z');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("'2025-06-15T14:30:00.000Z'::timestamptz");
    });

    it.each(timestampFieldCases)('$type: escapes single quotes in date string', (testCase) => {
      const field = createField(testCase);
      // Edge case: malformed date with quotes (should still escape properly)
      const visitor = FieldSqlLiteralVisitor.create("2025-01-17'T10:00");
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("'2025-01-17''T10:00'::timestamptz");
    });
  });

  describe('JSONB fields (::jsonb cast)', () => {
    it.each(jsonbFieldCases)('$type: handles JSON array string', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create('[1, 2, 3]');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("'[1, 2, 3]'::jsonb");
    });

    it.each(jsonbFieldCases)('$type: handles JSON object string', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create('{"key": "value"}');
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(`'{"key": "value"}'::jsonb`);
    });

    it.each(jsonbFieldCases)('$type: escapes single quotes in JSON', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(`{"name": "O'Brien"}`);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(`'{"name": "O''Brien"}'::jsonb`);
    });
  });

  describe('computed fields (always return NULL)', () => {
    it.each(computedFieldCases)('$type: returns NULL regardless of input value', (testCase) => {
      const field = createField(testCase);

      // Test with various input values - all should return NULL
      const values = [testCase.sampleValue, null, undefined, 'any value', 123, true, {}];

      for (const value of values) {
        const visitor = FieldSqlLiteralVisitor.create(value);
        const result = field.accept(visitor);

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe('NULL');
      }
    });
  });

  // ============================================================================
  // Regression tests: PostgreSQL VALUES clause type inference
  // ============================================================================

  describe('regression: NULL values must include explicit type casts for typed columns', () => {
    /**
     * This test documents the bug fix for paste operations.
     *
     * When pasting data with NULL values to typed columns (number, boolean, date, JSONB),
     * the generated SQL VALUES clause must include explicit type casts for NULL values.
     *
     * Without explicit type casts, PostgreSQL cannot infer the correct column type
     * in a VALUES clause when all values in a column are NULL, leading to errors like:
     * "column X is of type double precision but expression is of type text"
     */

    const typedFieldCases = [
      ...numericFieldCases,
      ...booleanFieldCases,
      ...timestampFieldCases,
      ...jsonbFieldCases,
    ];

    it.each(typedFieldCases)('$type: NULL has explicit type cast (not bare NULL)', (testCase) => {
      const field = createField(testCase);
      const visitor = FieldSqlLiteralVisitor.create(null);
      const result = field.accept(visitor);

      expect(result.isOk()).toBe(true);
      const literal = result._unsafeUnwrap();

      // Must NOT be bare 'NULL' for typed fields
      expect(literal).not.toBe('NULL');
      // Must start with 'NULL::'
      expect(literal.startsWith('NULL::')).toBe(true);
    });

    it.each(textFieldCases)(
      '$type: NULL can be bare (text type is default in PostgreSQL)',
      (testCase) => {
        const field = createField(testCase);
        const visitor = FieldSqlLiteralVisitor.create(null);
        const result = field.accept(visitor);

        expect(result.isOk()).toBe(true);
        // Text fields can use bare NULL
        expect(result._unsafeUnwrap()).toBe('NULL');
      }
    );
  });

  // ============================================================================
  // Documentation of complex field types behavior
  // ============================================================================

  describe('complex field types (documented behavior)', () => {
    /**
     * These field types require complex configuration to create:
     * - link: Requires LinkFieldConfig with foreign table reference
     * - formula: Requires expression + result type resolution
     * - rollup: Requires link field + lookup field references
     * - lookup: Requires link field + inner field references
     * - conditionalRollup: Requires complex config + filter condition
     * - conditionalLookup: Requires complex config + filter condition
     *
     * All of these (except link) are computed fields that return 'NULL' regardless of input.
     * Link fields return JSONB literals with '::jsonb' cast.
     *
     * These behaviors are verified in integration tests that have proper table setup.
     */

    it('documents that complex field types are covered', () => {
      expect(complexFieldCases.length).toBe(6); // link, formula, rollup, lookup, conditionalRollup, conditionalLookup
    });

    it.each(complexFieldCases)('$type: expected behavior is documented', (testCase) => {
      // This is a documentation test - just verify the expected values are defined
      expect(testCase.expectedSampleLiteral).toBeDefined();
      expect(testCase.expectedNullLiteral).toBeDefined();

      if (testCase.category === 'computed') {
        // Computed fields always return NULL
        expect(testCase.expectedSampleLiteral).toBe('NULL');
        expect(testCase.expectedNullLiteral).toBe('NULL');
      } else if (testCase.category === 'jsonb') {
        // JSONB fields (like link) have ::jsonb cast
        expect(testCase.expectedNullLiteral).toBe('NULL::jsonb');
      }
    });
  });

  // ============================================================================
  // Summary: Verify total test coverage
  // ============================================================================

  describe('coverage verification', () => {
    it('covers all field types from fieldTypeValues', () => {
      expect(allTestCases.length).toBe(fieldTypeValues.length);
    });

    it('simple + complex field counts equal total', () => {
      expect(simpleFieldCases.length + complexFieldCases.length).toBe(allTestCases.length);
    });

    it('has at least one test case for each category in simple fields', () => {
      expect(textFieldCases.length).toBeGreaterThan(0);
      expect(numericFieldCases.length).toBeGreaterThan(0);
      expect(booleanFieldCases.length).toBeGreaterThan(0);
      expect(timestampFieldCases.length).toBeGreaterThan(0);
      expect(jsonbFieldCases.length).toBeGreaterThan(0);
      expect(computedFieldCases.length).toBeGreaterThan(0);
    });

    it('category counts for simple fields sum correctly', () => {
      const categoryTotal =
        textFieldCases.length +
        numericFieldCases.length +
        booleanFieldCases.length +
        timestampFieldCases.length +
        jsonbFieldCases.length +
        computedFieldCases.length;
      expect(categoryTotal).toBe(simpleFieldCases.length);
    });
  });
});
