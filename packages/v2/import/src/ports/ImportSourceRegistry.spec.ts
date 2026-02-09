import { describe, expect, it } from 'vitest';

import { CsvImportAdapter } from '../adapters/CsvImportAdapter';
import { ExcelImportAdapter } from '../adapters/ExcelImportAdapter';
import { ImportSourceRegistry } from './ImportSourceRegistry';

describe('ImportSourceRegistry', () => {
  describe('register', () => {
    it('registers an adapter', () => {
      const registry = new ImportSourceRegistry();
      const adapter = new CsvImportAdapter();

      registry.register(adapter);

      expect(registry.supports('csv')).toBe(true);
      expect(registry.supports('tsv')).toBe(true);
      expect(registry.supports('txt')).toBe(true);
    });

    it('registers multiple adapters', () => {
      const registry = new ImportSourceRegistry();

      registry.register(new CsvImportAdapter());
      registry.register(new ExcelImportAdapter());

      expect(registry.supports('csv')).toBe(true);
      expect(registry.supports('xlsx')).toBe(true);
    });
  });

  describe('getAdapter', () => {
    it('returns adapter for registered type', () => {
      const registry = new ImportSourceRegistry();
      const adapter = new CsvImportAdapter();
      registry.register(adapter);

      const result = registry.getAdapter('csv');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(adapter);
      }
    });

    it('returns error for unregistered type', () => {
      const registry = new ImportSourceRegistry();

      const result = registry.getAdapter('unknown');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('import.unsupported_type');
      }
    });
  });

  describe('getSupportedTypes', () => {
    it('returns empty array when no adapters registered', () => {
      const registry = new ImportSourceRegistry();

      expect(registry.getSupportedTypes()).toEqual([]);
    });

    it('returns all supported types', () => {
      const registry = new ImportSourceRegistry();
      registry.register(new CsvImportAdapter());
      registry.register(new ExcelImportAdapter());

      const types = registry.getSupportedTypes();

      expect(types).toContain('csv');
      expect(types).toContain('tsv');
      expect(types).toContain('txt');
      expect(types).toContain('xlsx');
      expect(types).toContain('xls');
      expect(types).toContain('excel');
    });
  });

  describe('supports', () => {
    it('returns false for unsupported type', () => {
      const registry = new ImportSourceRegistry();

      expect(registry.supports('unknown')).toBe(false);
    });

    it('returns true for supported type', () => {
      const registry = new ImportSourceRegistry();
      registry.register(new CsvImportAdapter());

      expect(registry.supports('csv')).toBe(true);
    });
  });
});
