import { describe, expect, it } from 'vitest';
import { DuplicateFieldCommand } from './DuplicateFieldCommand';

describe('DuplicateFieldCommand', () => {
  describe('create', () => {
    it('should create a valid command with all required fields', () => {
      const input = {
        baseId: 'bseaaaaaaaaaaaaaaaa',
        tableId: 'tblbbbbbbbbbbbbbbbb',
        fieldId: 'fldcccccccccccccccc',
        includeRecordValues: true,
      };

      const result = DuplicateFieldCommand.create(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.baseId.toString()).toBe(input.baseId);
        expect(result.value.tableId.toString()).toBe(input.tableId);
        expect(result.value.fieldId.toString()).toBe(input.fieldId);
        expect(result.value.includeRecordValues).toBe(true);
        expect(result.value.newFieldName).toBeUndefined();
      }
    });

    it('should create a valid command with custom field name', () => {
      const input = {
        baseId: 'bseaaaaaaaaaaaaaaaa',
        tableId: 'tblbbbbbbbbbbbbbbbb',
        fieldId: 'fldcccccccccccccccc',
        includeRecordValues: false,
        newFieldName: 'Custom Name',
      };

      const result = DuplicateFieldCommand.create(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.includeRecordValues).toBe(false);
        expect(result.value.newFieldName).toBe('Custom Name');
      }
    });

    it('should default includeRecordValues to true', () => {
      const input = {
        baseId: 'bseaaaaaaaaaaaaaaaa',
        tableId: 'tblbbbbbbbbbbbbbbbb',
        fieldId: 'fldcccccccccccccccc',
      };

      const result = DuplicateFieldCommand.create(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.includeRecordValues).toBe(true);
      }
    });

    it('should fail with invalid baseId', () => {
      const input = {
        baseId: 123,
        tableId: 'tblbbbbbbbbbbbbbbbb',
        fieldId: 'fldcccccccccccccccc',
        includeRecordValues: true,
      };

      const result = DuplicateFieldCommand.create(input);

      expect(result.isErr()).toBe(true);
    });

    it('should fail with invalid tableId', () => {
      const input = {
        baseId: 'bseaaaaaaaaaaaaaaaa',
        tableId: 'invalid',
        fieldId: 'fldcccccccccccccccc',
        includeRecordValues: true,
      };

      const result = DuplicateFieldCommand.create(input);

      expect(result.isErr()).toBe(true);
    });

    it('should fail with invalid fieldId', () => {
      const input = {
        baseId: 'bseaaaaaaaaaaaaaaaa',
        tableId: 'tblbbbbbbbbbbbbbbbb',
        fieldId: 'invalid',
        includeRecordValues: true,
      };

      const result = DuplicateFieldCommand.create(input);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('foreignTableReferences', () => {
    it('should return empty array (references resolved during handler execution)', () => {
      const input = {
        baseId: 'bseaaaaaaaaaaaaaaaa',
        tableId: 'tblbbbbbbbbbbbbbbbb',
        fieldId: 'fldcccccccccccccccc',
        includeRecordValues: true,
      };

      const result = DuplicateFieldCommand.create(input);
      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const refsResult = result.value.foreignTableReferences();
        expect(refsResult.isOk()).toBe(true);
        if (refsResult.isOk()) {
          expect(refsResult.value).toEqual([]);
        }
      }
    });
  });
});
