import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFieldInstance } from '../../model/field/factory';
import { CellValue } from './CellValue';

const multiValueText = createFieldInstance({
  id: 'fldSites',
  name: 'Sites',
  type: FieldType.SingleLineText,
  dbFieldName: 'sites',
  dbFieldType: DbFieldType.Json,
  cellValueType: CellValueType.String,
  isMultipleCellValue: true,
  options: {},
} as IFieldVo);

describe('CellValue text links', () => {
  it('joins multi-value text before detecting links', () => {
    const { container } = render(
      <CellValue field={multiValueText} value={['https://a.io/1', 'https://b.io/2']} />
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://a.io/1', 'https://b.io/2']);
    expect(container.textContent).toBe('https://a.io/1, https://b.io/2');
  });
});
