import { FieldType } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { convertLinkPasteCellValue } from './paste-link-cell-value';

describe('convertLinkPasteCellValue', () => {
  const textSource = {
    type: FieldType.SingleLineText,
    cellValue2String: vi.fn((value: unknown) => String(value ?? '')),
  };

  const linkSource = {
    type: FieldType.Link,
    cellValue2String: vi.fn((value: unknown) => {
      if (value == null) return '';
      const items = Array.isArray(value) ? value : [value];
      return items
        .map((item) =>
          typeof item === 'object' && item && 'title' in item
            ? String((item as { title?: string }).title ?? '')
            : String(item)
        )
        .join(', ');
    }),
  };

  it('preserves structured link titles when pasting into a single link field (T6106)', () => {
    const result = convertLinkPasteCellValue({ isMultipleCellValue: false }, linkSource, {
      id: 'recSku000000000001',
      title: 'SKU Grade 4 A+',
    });

    expect(result).toEqual({ id: 'recSku000000000001', title: 'SKU Grade 4 A+' });
  });

  it('preserves structured link titles when pasting into a multiple link field (T6106)', () => {
    const result = convertLinkPasteCellValue({ isMultipleCellValue: true }, linkSource, [
      { id: 'recSku000000000001', title: 'Alpha' },
      { id: 'recSku000000000002', title: 'Beta' },
    ]);

    expect(result).toEqual([
      { id: 'recSku000000000001', title: 'Alpha' },
      { id: 'recSku000000000002', title: 'Beta' },
    ]);
  });

  it('keeps plain title tokens as a typecast string', () => {
    expect(convertLinkPasteCellValue({ isMultipleCellValue: false }, linkSource, 'Alpha')).toBe(
      'Alpha'
    );
    expect(
      convertLinkPasteCellValue({ isMultipleCellValue: true }, linkSource, ['Alpha', 'Beta'])
    ).toBe('Alpha,Beta');
  });

  it('keeps id-only structured items without inventing titles', () => {
    expect(
      convertLinkPasteCellValue({ isMultipleCellValue: false }, linkSource, {
        id: 'recSku000000000001',
      })
    ).toEqual({ id: 'recSku000000000001' });
  });

  it('stringifies non-link source values', () => {
    expect(convertLinkPasteCellValue({ isMultipleCellValue: false }, textSource, 'hello')).toBe(
      'hello'
    );
    expect(textSource.cellValue2String).toHaveBeenCalledWith('hello');
  });

  it('returns null for empty values', () => {
    expect(convertLinkPasteCellValue({ isMultipleCellValue: false }, linkSource, null)).toBeNull();
    expect(convertLinkPasteCellValue({ isMultipleCellValue: false }, linkSource, '')).toBeNull();
    expect(convertLinkPasteCellValue({ isMultipleCellValue: false }, linkSource, [])).toBeNull();
  });
});
