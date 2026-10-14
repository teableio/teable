import type { DraggableProvided } from '@hello-pangea/dnd';
import type { IRecord } from '@teable/core';
import { CellValueType, Colors, DbFieldType, FieldType } from '@teable/core';
import type * as SdkHooks from '@teable/sdk/hooks';
import {
  createFieldInstance,
  createRecordInstance,
  recordInstanceFieldMap,
} from '@teable/sdk/model';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KanbanContext } from '../context/KanbanContext';
import { KanbanCard } from './KanbanCard';

vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useTableId: () => 'tblTest',
  useViewId: () => 'viwTest',
  useFieldStaticGetter: () => () => ({ Icon: () => null }),
}));
vi.mock('../../hooks/useContextMenu', () => ({ useContextMenu: () => ({}) }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@teable/sdk/context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const primary = createFieldInstance({
  id: 'fldName',
  name: 'Name',
  dbFieldName: 'name',
  type: FieldType.SingleLineText,
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
  options: {},
  isPrimary: true,
});
const button = createFieldInstance({
  id: 'fldRun',
  name: 'Action',
  dbFieldName: 'run',
  type: FieldType.Button,
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Json,
  options: { label: 'Run', color: Colors.Teal },
});
const text = createFieldInstance({
  id: 'fldNotes',
  name: 'Notes',
  dbFieldName: 'notes',
  type: FieldType.SingleLineText,
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
  options: {},
});
const lookup = createFieldInstance({
  id: 'fldLookup',
  name: 'Empty lookup',
  dbFieldName: 'lookup',
  type: FieldType.Button,
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Json,
  isLookup: true,
  options: { label: 'Lookup run', color: Colors.Teal },
});
const provided: DraggableProvided = {
  innerRef: vi.fn(),
  draggableProps: {
    'data-rfd-draggable-id': 'recCard',
    'data-rfd-draggable-context-id': 'test',
  },
  dragHandleProps: null,
};

describe('KanbanCard unclicked button', () => {
  it.each([undefined, null])(
    'renders a visible button with value %s and preserves card expansion',
    (value) => {
      const expand = vi.fn();
      const card = recordInstanceFieldMap(
        createRecordInstance({
          id: 'recCard',
          fields: { [primary.id]: 'r1', [button.id]: value },
        } as IRecord),
        { [primary.id]: primary, [button.id]: button, [text.id]: text, [lookup.id]: lookup }
      );
      const { getByRole, queryByText, getByText, unmount } = render(
        <KanbanContext.Provider
          value={{
            permission: {
              stackCreatable: false,
              stackEditable: false,
              stackDeletable: false,
              stackDraggable: false,
              cardCreatable: false,
              cardEditable: false,
              cardDeletable: false,
              cardDraggable: false,
              cardCommentReadable: false,
              cardCommentCreatable: false,
            },
            stackField: primary,
            primaryField: primary,
            displayFields: [button, text, lookup],
            setExpandRecordId: expand,
          }}
        >
          <KanbanCard
            card={card}
            stack={{ id: 'uncategorized', data: null, count: 1 }}
            provided={provided}
          />
        </KanbanContext.Provider>
      );
      expect(getByRole('button', { name: 'Run' })).toBeTruthy();
      expect(queryByText('Notes')).toBeNull();
      expect(queryByText('Empty lookup')).toBeNull();
      fireEvent.click(getByRole('button', { name: 'Run' }));
      expect(expand).toHaveBeenLastCalledWith('recCard');
      fireEvent.click(getByText('r1'));
      expect(expand).toHaveBeenCalledTimes(2);
      unmount();
    }
  );
});
