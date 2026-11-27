import { FieldType } from '@teable/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ForwardedRef } from 'react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../context/__tests__/createAppContext';
import type { MultipleSelectField, Record } from '../../../model';
import type { IEditorRef } from '../../editor/type';
import { GridSelectEditor } from './GridSelectEditor';

vi.mock('../../../hooks', () => ({
  useTableId: () => 'tblTest00000000001',
  useTablePermission: () => ({ 'field|update': true }),
}));

vi.mock('../hooks', () => ({ useGridPopupPosition: () => ({}) }));

// The real option list is virtualized and renders nothing in jsdom. This stand-in shows the
// checked values the grid editor pushes into it and lets the test toggle options.
vi.mock('../../editor', () => ({
  SelectEditorMain: forwardRef(function SelectEditorMain(
    props: { value?: string[]; onChange: (value: string[]) => void },
    ref: ForwardedRef<IEditorRef<string[]>>
  ) {
    const [value, setValue] = useState<string[]>(props.value ?? []);
    useImperativeHandle(ref, () => ({ setValue: (next) => setValue(next ?? []) }));
    const toggle = (option: string) => {
      const next = value.includes(option) ? value.filter((v) => v !== option) : [...value, option];
      setValue(next);
      props.onChange(next);
    };
    return (
      <>
        <span data-testid="checked">{value.join(',')}</span>
        <button type="button" onClick={() => toggle('a')}>
          toggle a
        </button>
        <button type="button" onClick={() => toggle('b')}>
          toggle b
        </button>
      </>
    );
  }),
}));

const field = {
  id: 'fldSelect000000001',
  type: FieldType.MultipleSelect,
  options: { choices: [{ name: 'a' }, { name: 'b' }] },
  displayChoiceMap: {},
} as unknown as MultipleSelectField;

const wrapper = createAppContext();
// The grid passes cell and theme as well; this editor only reads the rect and editing flag.
const editorProps = {
  field,
  rect: { x: 0, y: 0, width: 100, height: 32, editorId: 'editor' },
  isEditing: true,
} as unknown as Omit<ComponentProps<typeof GridSelectEditor>, 'record'>;

// A record's cell value changes twice per click: once from the local optimistic write and once
// when the server publishes the op. `updateCell` stays pending until the test settles it.
const setup = () => {
  const saves: Array<(error?: Error) => void> = [];
  const makeRecord = (cellValue: string[] | null, id = 'recTest00000000001') =>
    ({
      id,
      getCellValue: () => cellValue,
      updateCell: vi.fn(() => new Promise<Error | undefined>((resolve) => saves.push(resolve))),
    }) as unknown as Record;

  let record = makeRecord(null);
  const ui = (r: Record) => <GridSelectEditor {...editorProps} record={r} />;
  const view = render(ui(record), { wrapper });
  const setCellValue = (cellValue: string[] | null, id = record.id) => {
    const updateCell = record.updateCell;
    record = makeRecord(cellValue, id);
    record.updateCell = updateCell;
    view.rerender(ui(record));
  };
  return { saves, setCellValue };
};

describe('GridSelectEditor', () => {
  it('keeps a later toggle when the echo of an earlier save arrives', () => {
    const { setCellValue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'toggle a' }));
    setCellValue(['a']);
    fireEvent.click(screen.getByRole('button', { name: 'toggle b' }));
    setCellValue(['a', 'b']);

    // The server publishes the first save after the second click was applied locally.
    setCellValue(['a']);

    expect(screen.getByTestId('checked')).toHaveTextContent('a,b');
  });

  it('shows the cell value again once a failed save rolls the cell back', async () => {
    const { saves, setCellValue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'toggle a' }));
    setCellValue(['a']);
    // updateCell rolls the cell back and resolves with the error.
    setCellValue(null);
    await act(async () => {
      saves[0](new Error('save failed'));
    });

    expect(screen.getByTestId('checked')).toHaveTextContent('');
  });

  it('follows a collaborator change when no save is in flight', async () => {
    const { saves, setCellValue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'toggle a' }));
    setCellValue(['a']);
    await act(async () => {
      saves[0]();
    });
    setCellValue(['a', 'b']);

    expect(screen.getByTestId('checked')).toHaveTextContent('a,b');
  });

  it('applies a collaborator change that arrived during a save once the save settles', async () => {
    const { saves, setCellValue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'toggle a' }));
    setCellValue(['a']);
    // A collaborator adds b after this save was committed, before its response arrives.
    setCellValue(['a', 'b']);
    expect(screen.getByTestId('checked')).toHaveTextContent('a');
    await act(async () => {
      saves[0]();
    });

    expect(screen.getByTestId('checked')).toHaveTextContent('a,b');
  });

  it('follows the next cell while the previous cell is still saving', () => {
    const { setCellValue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'toggle a' }));
    setCellValue(['a']);
    setCellValue(['b'], 'recTest00000000002');
    setCellValue(['b', 'c'], 'recTest00000000002');

    expect(screen.getByTestId('checked')).toHaveTextContent('b,c');
  });

  it('shows the rolled-back value when an earlier save failed and a later one succeeded', async () => {
    const { saves, setCellValue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'toggle a' }));
    setCellValue(['a']);
    fireEvent.click(screen.getByRole('button', { name: 'toggle b' }));
    setCellValue(['a', 'b']);
    // The second save fails and rolls the cell back, then the first one succeeds.
    setCellValue(['a']);
    await act(async () => {
      saves[1](new Error('save failed'));
    });
    await act(async () => {
      saves[0]();
    });

    expect(screen.getByTestId('checked')).toHaveTextContent('a');
    expect(screen.getByTestId('checked')).not.toHaveTextContent('b');
  });

  it('shows a cell own value when returning to it while its save is pending', () => {
    const { setCellValue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'toggle a' }));
    setCellValue(['a']);
    setCellValue(['c'], 'recTest00000000002');
    setCellValue(['a'], 'recTest00000000001');

    expect(screen.getByTestId('checked')).toHaveTextContent('a');
    expect(screen.getByTestId('checked')).not.toHaveTextContent('c');
  });
});
