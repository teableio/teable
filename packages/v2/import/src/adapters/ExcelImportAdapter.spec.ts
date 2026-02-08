import { describe, expect, it } from 'vitest';

import { ExcelImportAdapter } from './ExcelImportAdapter';

describe('ExcelImportAdapter', () => {
  const adapter = new ExcelImportAdapter();

  describe('supports', () => {
    it('supports xlsx type', () => {
      expect(adapter.supports('xlsx')).toBe(true);
    });

    it('supports xls type', () => {
      expect(adapter.supports('xls')).toBe(true);
    });

    it('supports excel type', () => {
      expect(adapter.supports('excel')).toBe(true);
    });

    it('does not support unsupported types', () => {
      expect(adapter.supports('csv')).toBe(false);
      expect(adapter.supports('json')).toBe(false);
    });
  });

  describe('supportedTypes', () => {
    it('returns all supported types', () => {
      expect(adapter.supportedTypes).toEqual(['xlsx', 'xls', 'excel']);
    });
  });

  describe('parse', () => {
    it('returns error when no url, data, or stream provided', async () => {
      const source = {
        type: 'xlsx',
      };

      const result = await adapter.parse(source);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('import.excel.invalid_source');
      }
    });
  });
});
