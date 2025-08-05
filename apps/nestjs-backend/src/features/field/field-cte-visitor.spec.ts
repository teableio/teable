import { DriverClient, FieldType } from '@teable/core';
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
});
