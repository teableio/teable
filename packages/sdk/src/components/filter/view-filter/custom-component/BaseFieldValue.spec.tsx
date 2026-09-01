import { CellValueType, FieldType } from '@teable/core';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../../context/__tests__/createAppContext';
import type { IFieldInstance } from '../../../../model';
import { BaseFieldValue } from './BaseFieldValue';

const wrapper = createAppContext();

const autoNumberField = {
  id: 'fldAuto00000000001',
  name: 'No.',
  type: FieldType.AutoNumber,
  cellValueType: CellValueType.Number,
  isMultipleCellValue: false,
  options: { expression: 'AUTO_NUMBER()' },
} as IFieldInstance;

const renderAutoNumberFilter = (value: unknown) =>
  render(
    <BaseFieldValue
      field={autoNumberField}
      operator="isGreater"
      value={value}
      onSelect={vi.fn()}
    />,
    { wrapper }
  );

describe('BaseFieldValue AutoNumber', () => {
  it('renders a persisted string numeric filter value in NumberEditor', () => {
    const { container } = renderAutoNumberFilter('50');
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('50');
  });

  it('renders a numeric filter value in NumberEditor', () => {
    const { container } = renderAutoNumberFilter(50);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('50');
  });
});
