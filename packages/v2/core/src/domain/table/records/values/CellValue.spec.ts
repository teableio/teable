import { describe, expect, it } from 'vitest';

import { CellValue } from './CellValue';

describe('CellValue', () => {
  describe('create', () => {
    it('should create a CellValue with a string value', () => {
      const result = CellValue.create<string>('hello');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().toValue()).toBe('hello');
    });

    it('should create a CellValue with a number value', () => {
      const result = CellValue.create<number>(42);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().toValue()).toBe(42);
    });

    it('should create a CellValue with a null value', () => {
      const result = CellValue.create<string>(null);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().toValue()).toBeNull();
    });

    it('should create a CellValue with an array value', () => {
      const result = CellValue.create<string[]>(['a', 'b', 'c']);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().toValue()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('fromValidated', () => {
    it('should create a CellValue directly', () => {
      const cellValue = CellValue.fromValidated<string>('test');
      expect(cellValue.toValue()).toBe('test');
    });
  });

  describe('null', () => {
    it('should create a null CellValue', () => {
      const cellValue = CellValue.null<string>();
      expect(cellValue.toValue()).toBeNull();
      expect(cellValue.isNull()).toBe(true);
    });
  });

  describe('isNull', () => {
    it('should return true for null value', () => {
      const cellValue = CellValue.fromValidated<string>(null);
      expect(cellValue.isNull()).toBe(true);
    });

    it('should return false for non-null value', () => {
      const cellValue = CellValue.fromValidated<string>('test');
      expect(cellValue.isNull()).toBe(false);
    });
  });

  describe('equals', () => {
    it('should return true for equal string values', () => {
      const a = CellValue.fromValidated<string>('hello');
      const b = CellValue.fromValidated<string>('hello');
      expect(a.equals(b)).toBe(true);
    });

    it('should return false for different string values', () => {
      const a = CellValue.fromValidated<string>('hello');
      const b = CellValue.fromValidated<string>('world');
      expect(a.equals(b)).toBe(false);
    });

    it('should return true for both null values', () => {
      const a = CellValue.null<string>();
      const b = CellValue.null<string>();
      expect(a.equals(b)).toBe(true);
    });

    it('should return false when one is null and other is not', () => {
      const a = CellValue.fromValidated<string>('hello');
      const b = CellValue.null<string>();
      expect(a.equals(b)).toBe(false);
    });
  });
});
