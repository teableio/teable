import { CellValueType, FieldType, SortFunc, type ISortItem } from '@teable/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SingleLineTextField } from '../../model';
import { ButtonField } from '../../model/field/button.field';
import { Group } from '../group/Group';
import { SortContent } from './SortContent';

const fields = [
  Object.assign(new SingleLineTextField(), {
    id: 'fldName',
    name: 'Name',
    type: FieldType.SingleLineText,
    cellValueType: CellValueType.String,
  }),
  Object.assign(new ButtonField(), {
    id: 'fldAction',
    name: 'Action',
    type: FieldType.Button,
    cellValueType: CellValueType.String,
  }),
];

vi.mock('../../hooks', () => ({
  useFields: () => fields,
  useTables: () => [],
  useView: () => ({ isLocked: false }),
  usePersonalView: () => ({ isPersonalView: false }),
  useIsHydrated: () => true,
  useIsMobile: () => false,
  useFieldStaticGetter: () => () => ({ Icon: () => null }),
}));

vi.mock('../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key, tPlural: (key: string) => key }),
}));

afterEach(cleanup);

function GroupEditor({ initial = [] }: { initial?: ISortItem[] }) {
  const [group, setGroup] = useState(initial);
  return (
    <Group group={group} onChange={(value) => setGroup(value ?? [])}>
      {() => <button type="button">Group</button>}
    </Group>
  );
}

describe('button grouping field selection (T7781)', () => {
  it('finds and selects a button as the first group, with numeric direction labels', async () => {
    render(<GroupEditor />);
    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.change(screen.getByPlaceholderText('common.search.placeholder'), {
      target: { value: 'Action' },
    });
    fireEvent.click(await screen.findByRole('option', { name: 'Action' }));
    expect((await screen.findByText('Action')).closest('[role="combobox"]')).toBeTruthy();
    expect(screen.getByText('1 → 9')).toBeTruthy();
  });

  it('allows adding a button after another group', async () => {
    render(<GroupEditor initial={[{ fieldId: 'fldName', order: SortFunc.Asc }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(screen.getByRole('button', { name: 'group.addButton' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Action' }));
    await waitFor(() => {
      expect(screen.getByText('Name').closest('[role="combobox"]')).toBeTruthy();
      expect(screen.getByText('Action').closest('[role="combobox"]')).toBeTruthy();
    });
  });

  it('allows replacing an existing group with a button', async () => {
    render(<GroupEditor initial={[{ fieldId: 'fldName', order: SortFunc.Asc }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(await screen.findByRole('option', { name: 'Action' }));
    expect((await screen.findByText('Action')).closest('[role="combobox"]')).toBeTruthy();
    expect(screen.queryByText('Name')).toBeNull();
  });

  it('preserves the standalone sort picker restriction', () => {
    render(<SortContent onChange={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Name' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Action' })).toBeNull();
  });
});
