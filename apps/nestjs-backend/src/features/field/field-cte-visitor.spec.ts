import { DriverClient, FieldType, Relationship } from '@teable/core';
import { vi } from 'vitest';
import { FieldCteVisitor, type IFieldCteContext } from './field-cte-visitor';
import type { IFieldInstance } from './model/factory';

describe('FieldCteVisitor', () => {
  let visitor: FieldCteVisitor;
  let mockDbProvider: any;
  let context: IFieldCteContext;

  beforeEach(() => {
    mockDbProvider = {
      driver: DriverClient.Pg,
    };

    const mockLookupField: IFieldInstance = {
      id: 'fld_lookup',
      type: FieldType.SingleLineText,
      dbFieldName: 'fld_lookup',
    } as any;

    context = {
      mainTableName: 'main_table',
      fieldMap: new Map([['fld_lookup', mockLookupField]]),
      tableNameMap: new Map([['tbl_foreign', 'foreign_table']]),
    };

    visitor = new FieldCteVisitor(mockDbProvider, context);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('visitLinkField', () => {
    it('should skip lookup Link fields', () => {
      const mockLinkField: IFieldInstance = {
        id: 'fld_link',
        type: FieldType.Link,
        isLookup: true,
        accept: vi.fn(),
      } as any;

      const result = visitor.visitLinkField(mockLinkField as any);

      expect(result.hasChanges).toBe(false);
      expect(result.cteName).toBeUndefined();
      expect(result.cteCallback).toBeUndefined();
    });

    it('should return no changes for non-Link fields', () => {
      const result = visitor.visitSingleLineTextField({} as any);
      expect(result.hasChanges).toBe(false);
    });
  });

  describe('getLinkJsonAggregationFunction', () => {
    it('should generate PostgreSQL JSON aggregation for multi-value relationships', () => {
      // Access private method for testing
      const visitor = new FieldCteVisitor(mockDbProvider, context);
      const method = (visitor as any).getLinkJsonAggregationFunction;

      const result = method.call(visitor, 'f', 'f."title"', Relationship.OneMany);

      expect(result).toBe(
        `COALESCE(json_agg(json_build_object('id', f."__id", 'title', f."title")) FILTER (WHERE f."__id" IS NOT NULL), '[]'::json)`
      );
    });

    it('should generate PostgreSQL JSON aggregation for single-value relationships', () => {
      const visitor = new FieldCteVisitor(mockDbProvider, context);
      const method = (visitor as any).getLinkJsonAggregationFunction;

      const result = method.call(visitor, 'f', 'f."title"', Relationship.ManyOne);

      expect(result).toBe(
        `CASE WHEN f."__id" IS NOT NULL THEN json_build_object('id', f."__id", 'title', f."title") ELSE NULL END`
      );
    });

    it('should generate SQLite JSON aggregation for multi-value relationships', () => {
      const sqliteDbProvider = {
        driver: DriverClient.Sqlite,
        createColumnSchema: jest.fn().mockReturnValue([]),
      } as any;

      const visitor = new FieldCteVisitor(sqliteDbProvider, context);
      const method = (visitor as any).getLinkJsonAggregationFunction;

      const result = method.call(visitor, 'f', 'f."title"', Relationship.ManyMany);

      expect(result).toBe(
        `CASE WHEN COUNT(f."__id") > 0 THEN json_group_array(json_object('id', f."__id", 'title', f."title")) ELSE '[]' END`
      );
    });

    it('should generate SQLite JSON aggregation for single-value relationships', () => {
      const sqliteDbProvider = {
        driver: DriverClient.Sqlite,
        createColumnSchema: jest.fn().mockReturnValue([]),
      } as any;

      const visitor = new FieldCteVisitor(sqliteDbProvider, context);
      const method = (visitor as any).getLinkJsonAggregationFunction;

      const result = method.call(visitor, 'f', 'f."title"', Relationship.OneOne);

      expect(result).toBe(
        `CASE WHEN f."__id" IS NOT NULL THEN json_object('id', f."__id", 'title', f."title") ELSE NULL END`
      );
    });

    it('should throw error for unsupported database driver', () => {
      const unsupportedDbProvider = {
        driver: 'mysql' as any,
        createColumnSchema: jest.fn().mockReturnValue([]),
      } as any;

      const visitor = new FieldCteVisitor(unsupportedDbProvider, context);
      const method = (visitor as any).getLinkJsonAggregationFunction;

      expect(() => method.call(visitor, 'f', 'f."title"', Relationship.ManyOne)).toThrow(
        'Unsupported database driver: mysql'
      );
    });
  });
});
