import { CellValueType, DbFieldType, FieldType, NumberFormattingType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFieldInstance } from '../../model/field/factory';
import { CellEditor } from './CellEditor';

const numberField = (type: NumberFormattingType) =>
  createFieldInstance({
    id: 'fldRatio',
    name: 'Ratio',
    type: FieldType.Number,
    dbFieldName: 'ratio',
    dbFieldType: DbFieldType.Real,
    cellValueType: CellValueType.Number,
    options: {
      formatting: { type, precision: 0 },
    },
  } as IFieldVo);

const percentField = numberField(NumberFormattingType.Percent);

/**
 * Expand record (CellEditorWrap) and the form (FormCellEditor) both edit a
 * percent number through CellEditor. Grid uses GridNumberEditor and is not
 * covered here.
 */
const renderPercentEditor = (cellValue: number | null, onChange = vi.fn()) => {
  const view = render(
    <CellEditor field={percentField} cellValue={cellValue} onChange={onChange} />
  );
  return { ...view, onChange, input: view.container.querySelector('input') as HTMLInputElement };
};

describe('percent number CellEditor used by expand record and form', () => {
  it.each(['expand record', 'form'] as const)(
    'shows a stored 0.25 as 25 and stores a bare 50 as 0.5 from the %s editor',
    (entry) => {
      const onChange = vi.fn();
      const { input } = renderPercentEditor(0.25, onChange);

      expect(input.value, entry).toBe('25');

      fireEvent.change(input, { target: { value: '50' } });
      fireEvent.blur(input);

      expect(onChange).toHaveBeenCalledWith(0.5);
    }
  );

  it('resets the displayed percent draft when formatting changes to decimal', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <CellEditor field={percentField} cellValue={0.25} onChange={onChange} />
    );
    const input = container.querySelector('input') as HTMLInputElement;

    expect(input.value).toBe('25');

    rerender(
      <CellEditor
        field={numberField(NumberFormattingType.Decimal)}
        cellValue={0.25}
        onChange={onChange}
      />
    );
    const nextInput = container.querySelector('input') as HTMLInputElement;
    expect(nextInput.value).toBe('0.25');

    fireEvent.blur(nextInput);
    expect(onChange).toHaveBeenCalledWith(0.25);
  });
});
