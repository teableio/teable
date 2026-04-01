import { CellValueType, FieldType } from '@teable/core';
import type { IFieldInstance } from '../../features/field/model/factory';
import { FieldFormatter, IndexBuilderPostgres } from './search-index-builder.postgres';

function createMockField(overrides: Partial<IFieldInstance> = {}): IFieldInstance {
  return {
    id: 'fldTestField123',
    dbFieldName: 'test_field',
    cellValueType: CellValueType.String,
    type: FieldType.SingleLineText,
    options: {},
    isStructuredCellValue: false,
    isMultipleCellValue: false,
    ...overrides,
  } as IFieldInstance;
}

// --- FieldFormatter.getIndexExpression ---

describe('FieldFormatter.getIndexExpression', () => {
  describe('with truncation', () => {
    it('wraps string field expression with LEFT()', () => {
      const field = createMockField();
      const result = FieldFormatter.getIndexExpression(field, 1000);
      expect(result).toBe('LEFT(("test_field")::text, 1000)');
    });

    it('wraps LongText field expression with LEFT()', () => {
      const field = createMockField({ type: FieldType.LongText });
      const result = FieldFormatter.getIndexExpression(field, 500);
      expect(result).toContain('LEFT(');
      expect(result).toContain('500)');
      expect(result).toContain('REPLACE');
    });

    it('wraps Number field expression with LEFT()', () => {
      const field = createMockField({
        cellValueType: CellValueType.Number,
        options: { formatting: { precision: 2 } },
      });
      const result = FieldFormatter.getIndexExpression(field, 1000);
      expect(result).toBe('LEFT((ROUND("test_field"::numeric, 2)::text)::text, 1000)');
    });

    it('returns null for DateTime fields regardless of truncation', () => {
      const field = createMockField({ cellValueType: CellValueType.DateTime });
      expect(FieldFormatter.getIndexExpression(field, 1000)).toBeNull();
    });

    it('returns null for Boolean fields regardless of truncation', () => {
      const field = createMockField({ cellValueType: CellValueType.Boolean });
      expect(FieldFormatter.getIndexExpression(field, 1000)).toBeNull();
    });

    it('wraps structured cell value expression with LEFT()', () => {
      const field = createMockField({ isStructuredCellValue: true });
      const result = FieldFormatter.getIndexExpression(field, 1000);
      expect(result).toContain('LEFT(');
      expect(result).toContain("title");
      expect(result).toContain('1000)');
    });

    it('wraps array field expression with LEFT()', () => {
      const field = createMockField({ isMultipleCellValue: true });
      const result = FieldFormatter.getIndexExpression(field, 1000);
      expect(result).toBe('LEFT(("test_field"::text)::text, 1000)');
    });

    it('uses specified truncate length', () => {
      const field = createMockField();
      expect(FieldFormatter.getIndexExpression(field, 500)).toContain('500)');
      expect(FieldFormatter.getIndexExpression(field, 2000)).toContain('2000)');
    });
  });

  describe('without truncation', () => {
    it('returns raw expression when truncateLength is undefined', () => {
      const field = createMockField();
      const result = FieldFormatter.getIndexExpression(field);
      expect(result).toBe('"test_field"');
      expect(result).not.toContain('LEFT');
    });

    it('returns raw expression when truncateLength is 0 (escape hatch)', () => {
      const field = createMockField();
      const result = FieldFormatter.getIndexExpression(field, 0);
      expect(result).toBe('"test_field"');
      expect(result).not.toContain('LEFT');
    });

    it('returns raw expression when truncateLength is negative', () => {
      const field = createMockField();
      const result = FieldFormatter.getIndexExpression(field, -1);
      expect(result).toBe('"test_field"');
      expect(result).not.toContain('LEFT');
    });
  });
});

// --- IndexBuilderPostgres.createSingleIndexSql ---

describe('IndexBuilderPostgres.createSingleIndexSql', () => {
  it('generates SQL with LEFT() when truncateLength is set', () => {
    const builder = new IndexBuilderPostgres(1000);
    const field = createMockField();
    const sql = builder.createSingleIndexSql('schema.table', field);

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(sql).toContain('USING gin');
    expect(sql).toContain('gin_trgm_ops');
    expect(sql).toContain('LEFT(');
    expect(sql).toContain('1000)');
  });

  it('generates SQL without LEFT() when truncateLength is undefined', () => {
    const builder = new IndexBuilderPostgres();
    const field = createMockField();
    const sql = builder.createSingleIndexSql('schema.table', field);

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(sql).toContain('USING gin');
    expect(sql).not.toContain('LEFT(');
  });

  it('generates SQL without LEFT() when truncateLength is 0', () => {
    const builder = new IndexBuilderPostgres(0);
    const field = createMockField();
    const sql = builder.createSingleIndexSql('schema.table', field);

    expect(sql).not.toContain('LEFT(');
  });

  it('returns null for unsupported field types', () => {
    const builder = new IndexBuilderPostgres(1000);
    const field = createMockField({ cellValueType: CellValueType.DateTime });
    expect(builder.createSingleIndexSql('schema.table', field)).toBeNull();
  });
});

// --- IndexBuilderPostgres.getAbnormalIndex ---

describe('IndexBuilderPostgres.getAbnormalIndex', () => {
  it('detects old-format indexes (without LEFT()) as abnormal', () => {
    const builder = new IndexBuilderPostgres(1000);
    const field = createMockField();

    // Simulate an existing index WITHOUT LEFT() truncation
    const existingIndexes = [
      {
        schemaname: 'schema',
        tablename: 'table',
        indexname: `idx_trgm_table_test_field_${field.id}`,
        tablespace: '',
        indexdef: `CREATE INDEX idx_trgm_table_test_field_${field.id} ON schema.table USING gin (("test_field") gin_trgm_ops)`,
      },
    ];

    const abnormal = builder.getAbnormalIndex('schema.table', [field], existingIndexes);
    expect(abnormal.length).toBeGreaterThan(0);
  });

  it('does not flag matching indexes (with LEFT()) as abnormal', () => {
    const builder = new IndexBuilderPostgres(1000);
    const field = createMockField();

    // Simulate an existing index WITH LEFT() truncation (matching current config)
    const existingIndexes = [
      {
        schemaname: 'schema',
        tablename: 'table',
        indexname: `idx_trgm_table_test_field_${field.id}`,
        tablespace: '',
        indexdef: `CREATE INDEX idx_trgm_table_test_field_${field.id} ON schema.table USING gin ((LEFT(("test_field")::text, 1000)) gin_trgm_ops)`,
      },
    ];

    const abnormal = builder.getAbnormalIndex('schema.table', [field], existingIndexes);
    expect(abnormal).toHaveLength(0);
  });

  it('detects abnormal indexes when truncate length changes', () => {
    // Config says 500, but existing indexes were built with 1000
    const builder = new IndexBuilderPostgres(500);
    const field = createMockField();

    const existingIndexes = [
      {
        schemaname: 'schema',
        tablename: 'table',
        indexname: `idx_trgm_table_test_field_${field.id}`,
        tablespace: '',
        indexdef: `CREATE INDEX idx_trgm_table_test_field_${field.id} ON schema.table USING gin ((LEFT(("test_field")::text, 1000)) gin_trgm_ops)`,
      },
    ];

    const abnormal = builder.getAbnormalIndex('schema.table', [field], existingIndexes);
    expect(abnormal.length).toBeGreaterThan(0);
  });
});
