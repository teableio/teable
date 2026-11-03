import { CellValueType, FieldType } from '@teable/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../../context/__tests__/createAppContext';
import { FieldContext } from '../../../../context/field/FieldContext';
import type { IFieldInstance } from '../../../../model';
import { FilterWithTable } from '../../filter-with-table/FilterWithTable';
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

describe('BaseFieldValue field references', () => {
  const link = {
    id: 'fldLink0000000001',
    name: 'Link',
    type: FieldType.Link,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
  } as IFieldInstance;
  const textFormula = {
    id: 'fldFormulaText001',
    name: 'Text formula',
    type: FieldType.Formula,
    cellValueType: CellValueType.String,
    isPrimary: true,
  } as IFieldInstance;
  const fields = [
    textFormula,
    {
      id: 'fldText0000000001',
      name: 'Text',
      type: FieldType.SingleLineText,
      cellValueType: CellValueType.String,
    },
    {
      id: 'fldNumber00000001',
      name: 'Number formula',
      type: FieldType.Formula,
      cellValueType: CellValueType.Number,
    },
    {
      id: 'fldDate0000000001',
      name: 'Date formula',
      type: FieldType.Formula,
      cellValueType: CellValueType.DateTime,
    },
    {
      id: 'fldBoolean0000001',
      name: 'Boolean formula',
      type: FieldType.Formula,
      cellValueType: CellValueType.Boolean,
    },
    {
      id: 'fldUser0000000001',
      name: 'User',
      type: FieldType.User,
      cellValueType: CellValueType.String,
    },
    {
      id: 'fldAttachment0001',
      name: 'Attachment',
      type: FieldType.Attachment,
      cellValueType: CellValueType.String,
    },
    {
      id: 'fldMultiText00001',
      name: 'Multiple text',
      type: FieldType.Formula,
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
    },
  ] as IFieldInstance[];
  const reference = {
    type: 'field',
    fieldId: textFormula.id,
    tableId: 'tblHost0000000001',
  } as const;
  const referenceSource = {
    fields,
    tableId: reference.tableId,
    supportsLinkTitleReference: true,
  };
  const Filter = (props: Partial<ComponentProps<typeof BaseFieldValue>>) => (
    <FieldContext.Provider value={{ fields }}>
      <BaseFieldValue
        field={link}
        operator="is"
        value={reference}
        onSelect={vi.fn()}
        referenceSource={referenceSource}
        components={{ [FieldType.Link]: () => <span /> }}
        {...props}
      />
    </FieldContext.Provider>
  );

  it('selects a scalar text formula for link title equality without admitting other semantic types', async () => {
    const onSelect = vi.fn();
    render(<Filter onSelect={onSelect} />, { wrapper });

    fireEvent.click(screen.getByRole('combobox'));
    const textOption = await screen.findByRole('option', { name: 'Text formula' });
    expect(textOption).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('option', { name: 'Text' })).toHaveAttribute('aria-disabled', 'false');
    for (const name of [
      'Number formula',
      'Date formula',
      'Boolean formula',
      'User',
      'Attachment',
      'Multiple text',
    ]) {
      expect(screen.getByRole('option', { name })).toHaveAttribute('aria-disabled', 'true');
    }
    fireEvent.click(textOption);
    expect(onSelect).toHaveBeenCalledWith(reference);
  });

  it.each(['isNot', 'contains', 'isAnyOf'] as const)(
    'keeps title references disabled for %s',
    async (operator) => {
      render(<Filter operator={operator} />, { wrapper });
      fireEvent.click(screen.getByRole('combobox'));
      expect(await screen.findByRole('option', { name: 'Text formula' })).toHaveAttribute(
        'aria-disabled',
        'true'
      );
    }
  );

  it('preserves strict comparison when the runtime has not enabled title references', async () => {
    render(<Filter referenceSource={{ fields, tableId: reference.tableId }} />, { wrapper });
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: 'Text formula' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('clears a title reference when the operator changes to an unsupported comparison', () => {
    const onSelect = vi.fn();
    const view = render(<Filter onSelect={onSelect} />, { wrapper });
    view.rerender(<Filter onSelect={onSelect} operator="isNot" />);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('does not default to an incompatible field when there are no supported references', () => {
    const onSelect = vi.fn();
    render(
      <Filter
        value={undefined}
        onSelect={onSelect}
        referenceSource={{ fields, tableId: reference.tableId }}
      />,
      { wrapper }
    );
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Use field value' })).toBeDisabled();
  });

  it('preserves a saved reference until the asynchronous source fields are ready', async () => {
    const onSelect = vi.fn();
    const pendingSource = { ...referenceSource, fields: [], isReady: false };
    const view = render(<Filter onSelect={onSelect} referenceSource={pendingSource} />, {
      wrapper,
    });

    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<Filter onSelect={onSelect} referenceSource={referenceSource} />);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toHaveTextContent('Text formula');
  });

  it('clears a saved reference absent from successfully loaded metadata', () => {
    const onSelect = vi.fn();
    const missingReference = {
      type: 'field',
      fieldId: 'fldRemoved0000001',
      tableId: reference.tableId,
    } as const;
    render(
      <FieldContext.Provider value={{ fields }}>
        <BaseFieldValue
          field={link}
          operator="is"
          value={missingReference}
          onSelect={onSelect}
          referenceSource={{ ...referenceSource, isReady: true }}
          components={{ [FieldType.Link]: () => <span /> }}
        />
      </FieldContext.Provider>,
      { wrapper }
    );
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it.each(['runtime', 'field type'] as const)(
    'clears a reference after the parent remounts the value editor because its %s changed',
    (change) => {
      const onChange = vi.fn();
      const value = {
        conjunction: 'and' as const,
        filterSet: [{ fieldId: link.id, operator: 'is' as const, value: reference }],
      };
      const filter = (source: typeof referenceSource) => (
        <FieldContext.Provider value={{ fields }}>
          <FilterWithTable
            fields={[link]}
            context={{ isLoading: false, data: [] }}
            value={value}
            onChange={onChange}
            referenceSource={source}
          />
        </FieldContext.Provider>
      );
      const view = render(filter(referenceSource), { wrapper });
      view.rerender(
        filter({
          ...referenceSource,
          supportsLinkTitleReference: change !== 'runtime',
          fields:
            change === 'field type'
              ? [{ ...textFormula, cellValueType: CellValueType.Number } as IFieldInstance]
              : fields,
        })
      );
      expect(onChange).toHaveBeenCalledWith({
        conjunction: 'and',
        filterSet: [{ fieldId: link.id, operator: 'is', value: null }],
      });
    }
  );
});
