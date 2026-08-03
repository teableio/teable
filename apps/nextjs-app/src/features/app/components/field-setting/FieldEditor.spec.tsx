import { CellValueType, FieldType } from '@teable/core';
import type { IFieldInstance } from '@teable/sdk/model';
import { render, TestAnchorProvider } from '@/test-utils';
import { FieldEditor } from './FieldEditor';
import { FieldOperator } from './type';

const lookupFields = [
  {
    id: 'fldSingleLineText',
    type: FieldType.SingleLineText,
    cellValueType: CellValueType.String,
  },
  {
    id: 'fldNumber',
    type: FieldType.Number,
    cellValueType: CellValueType.Number,
  },
  {
    id: 'fldRollup',
    type: FieldType.Rollup,
    options: {
      expression: 'max({values})',
    },
    lookupOptions: {
      foreignTableId: 'mockTableId',
      linkFieldId: 'mockLinkId',
      lookupFieldId: 'mockFieldId',
    },
    cellValueType: CellValueType.Number,
  },
] as IFieldInstance[];

describe('field editor static tests', () => {
  it('should render text field options', async () => {
    const el = render(
      <TestAnchorProvider>
        <FieldEditor
          field={{
            type: FieldType.SingleLineText,
          }}
          onChange={() => undefined}
          operator={FieldOperator.Add}
        />
      </TestAnchorProvider>
    );
    expect(el.getByTestId('text-show-as')).toBeInTheDocument();
  });

  it('should render lookup text field options', async () => {
    const el = render(
      <TestAnchorProvider fields={lookupFields}>
        <FieldEditor
          field={{
            type: FieldType.SingleLineText,
            isLookup: true,
          }}
          operator={FieldOperator.Add}
          onChange={() => undefined}
        />
      </TestAnchorProvider>
    );
    expect(el.getByTestId('text-show-as')).toBeInTheDocument();
    expect(el.getByTestId('lookup-options')).toBeInTheDocument();
  });

  it('should render rollup field lookup options', async () => {
    const el = render(
      <TestAnchorProvider fields={lookupFields}>
        <FieldEditor
          field={{
            type: FieldType.Rollup,
          }}
          operator={FieldOperator.Add}
          onChange={() => undefined}
        />
      </TestAnchorProvider>
    );
    expect(el.getByTestId('lookup-options')).toBeInTheDocument();
  });

  it('should render rollup field field options', async () => {
    const el = render(
      <TestAnchorProvider fields={lookupFields}>
        <FieldEditor
          field={{
            type: FieldType.Rollup,
            lookupOptions: {
              foreignTableId: 'mockTableId',
              linkFieldId: 'mockLinkId',
              lookupFieldId: 'mockFieldId',
            },
          }}
          operator={FieldOperator.Add}
          onChange={() => undefined}
        />
      </TestAnchorProvider>
    );

    expect(el.getByTestId('lookup-options')).toBeInTheDocument();
    expect(el.getByTestId('rollup-options')).toBeInTheDocument();
  });

  it('should render single value formatting and showAs after pick lookup field', async () => {
    const el = render(
      <TestAnchorProvider fields={lookupFields}>
        <FieldEditor
          field={{
            type: FieldType.Rollup,
            options: {
              expression: 'countall({values})',
            },
            lookupOptions: {
              foreignTableId: 'mockTableId',
              linkFieldId: 'mockLinkId',
              lookupFieldId: 'mockFieldId',
            },
            cellValueType: CellValueType.Number,
          }}
          operator={FieldOperator.Add}
          onChange={() => undefined}
        />
      </TestAnchorProvider>
    );
    expect(el.getByTestId('single-number-show-as')).toBeInTheDocument();
  });
  it('should render multi value formatting and showAs after pick lookup field', async () => {
    const el = render(
      <TestAnchorProvider fields={lookupFields}>
        <FieldEditor
          field={{
            isLookup: true,
            type: FieldType.Rollup,
            options: {
              expression: 'countall({values})',
            },
            lookupOptions: {
              foreignTableId: 'mockTableId',
              linkFieldId: 'mockLinkId',
              lookupFieldId: 'mockFieldId',
            },
            cellValueType: CellValueType.Number,
            isMultipleCellValue: true,
          }}
          operator={FieldOperator.Add}
          onChange={() => undefined}
        />
      </TestAnchorProvider>
    );
    expect(el.getByTestId('multi-number-show-as')).toBeInTheDocument();
  });
});
