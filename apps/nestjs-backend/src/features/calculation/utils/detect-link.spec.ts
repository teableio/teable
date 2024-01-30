import { IdPrefix } from '@teable/core';
import { isLinkCellValue } from './detect-link';

describe('isLinkCellValue', () => {
  it('should return true for objects that are link cell values', () => {
    const linkCellItem = { id: IdPrefix.Record + '123' };
    expect(isLinkCellValue(linkCellItem)).toBe(true);
  });

  it('should return false for objects that are not link cell values', () => {
    const nonLinkCellItem = { id: IdPrefix.Table + '123' };
    expect(isLinkCellValue(nonLinkCellItem)).toBe(false);
  });

  it('should return true for arrays containing link cell items', () => {
    const linkCellItem = { id: IdPrefix.Record + '123' };
    expect(isLinkCellValue([linkCellItem])).toBe(true);
  });

  it('should return false for arrays not containing link cell items', () => {
    const nonLinkCellItem = { id: IdPrefix.Table + '123' };
    expect(isLinkCellValue([nonLinkCellItem])).toBe(false);
  });

  it('should return false for null values', () => {
    expect(isLinkCellValue(null)).toBe(false);
  });

  it('should return false for undefined values', () => {
    expect(isLinkCellValue(undefined)).toBe(false);
  });

  it('should return false for primitive values', () => {
    expect(isLinkCellValue('string')).toBe(false);
    expect(isLinkCellValue(123)).toBe(false);
    expect(isLinkCellValue(true)).toBe(false);
  });
});
