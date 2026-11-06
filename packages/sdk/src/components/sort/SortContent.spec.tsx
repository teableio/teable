import { CellValueType, FieldType, SortFunc, type ISortItem } from '@teable/core';
import type * as UiLib from '@teable/ui-lib';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField, SingleLineTextField } from '../../model';
import { ButtonField } from '../../model/field/button.field';
import { Group } from '../group/Group';
import { SortBase } from './SortBase';
import { SortContent } from './SortContent';

const mocks = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  viewSort: undefined as { sortObjs: ISortItem[]; manualSort?: boolean } | undefined,
}));

const fields = [
  Object.assign(new SingleLineTextField(), {
    id: 'fldName',
    name: 'Name',
    type: FieldType.SingleLineText,
    cellValueType: CellValueType.String,
  }),
  Object.assign(new NumberField(), {
    id: 'fldCount',
    name: 'Count',
    type: FieldType.Number,
    cellValueType: CellValueType.Number,
  }),
  Object.assign(new ButtonField(), {
    id: 'fldAction',
    name: 'Action',
    type: FieldType.Button,
    cellValueType: CellValueType.String,
  }),
];

vi.mock('@teable/ui-lib', async (importOriginal) => ({
  ...(await importOriginal<typeof UiLib>()),
  sonner: { toast: { warning: mocks.toastWarning } },
}));

vi.mock('../../hooks', () => ({
  useFields: () => fields,
  useTables: () => [],
  useView: () => ({ isLocked: false, sort: mocks.viewSort }),
  usePersonalView: () => ({ isPersonalView: false }),
  useIsHydrated: () => true,
  useIsMobile: () => false,
  useFieldStaticGetter: () => () => ({ Icon: () => null }),
}));

vi.mock('../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key, tPlural: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  mocks.toastWarning.mockReset();
  mocks.viewSort = undefined;
});

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

describe('pinyin sorting', () => {
  it.each([
    ['sort.pinyinASCLabel', SortFunc.Asc],
    ['sort.pinyinDESCLabel', SortFunc.Desc],
  ])('passes %s selection with pinyin collation', async (optionName, order) => {
    const onChange = vi.fn();
    render(
      <SortContent
        enablePinyin
        sortValues={[{ fieldId: 'fldName', order: SortFunc.Asc }]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'sort.orderTitle' }));
    fireEvent.click(await screen.findByRole('option', { name: optionName }));

    expect(onChange).toHaveBeenLastCalledWith([
      { fieldId: 'fldName', order, collation: 'zh-pinyin' },
    ]);
  });

  it('removes pinyin collation when returning to the default order', async () => {
    const onChange = vi.fn();
    render(
      <SortContent
        enablePinyin
        sortValues={[{ fieldId: 'fldName', order: SortFunc.Desc, collation: 'zh-pinyin' }]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'sort.orderTitle' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Z → A' }));

    expect(onChange).toHaveBeenLastCalledWith([{ fieldId: 'fldName', order: SortFunc.Desc }]);
  });

  it('removes pinyin collation when switching to an unsupported field', async () => {
    const onChange = vi.fn();
    render(
      <SortContent
        enablePinyin
        sortValues={[{ fieldId: 'fldName', order: SortFunc.Asc, collation: 'zh-pinyin' }]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(await screen.findByRole('option', { name: 'Count' }));

    expect(onChange).toHaveBeenLastCalledWith([{ fieldId: 'fldCount', order: SortFunc.Asc }]);
  });

  it('does not show pinyin order options for grouping', async () => {
    render(<GroupEditor initial={[{ fieldId: 'fldName', order: SortFunc.Asc }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'sort.orderTitle' }));

    expect(await screen.findByRole('option', { name: 'A → Z' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'sort.pinyinASCLabel' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'sort.pinyinDESCLabel' })).toBeNull();
  });
});

describe('pinyin sort and group conflicts', () => {
  it.each(['sort.pinyinASCLabel', 'sort.pinyinDESCLabel'])(
    'rejects %s for a grouped field and allows retry after removing the group',
    async (optionName) => {
      const onChange = vi.fn();
      const { rerender } = render(
        <SortBase
          group={[{ fieldId: 'fldName', order: SortFunc.Asc }]}
          sorts={{ sortObjs: [{ fieldId: 'fldName', order: SortFunc.Asc }] }}
          onChange={onChange}
        >
          <button type="button">Sort</button>
        </SortBase>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
      fireEvent.click(screen.getByRole('combobox', { name: 'sort.orderTitle' }));
      fireEvent.click(await screen.findByRole('option', { name: optionName }));

      expect(onChange).not.toHaveBeenCalled();
      expect(mocks.toastWarning).toHaveBeenCalledWith('sort.pinyinGroupConflict');

      rerender(
        <SortBase
          group={null}
          sorts={{ sortObjs: [{ fieldId: 'fldName', order: SortFunc.Asc }] }}
          onChange={onChange}
        >
          <button type="button">Sort</button>
        </SortBase>
      );
      fireEvent.click(screen.getByRole('combobox', { name: 'sort.orderTitle' }));
      fireEvent.click(await screen.findByRole('option', { name: optionName }));
      expect(onChange).toHaveBeenCalledWith({
        sortObjs: [
          {
            fieldId: 'fldName',
            order: optionName === 'sort.pinyinASCLabel' ? SortFunc.Asc : SortFunc.Desc,
            collation: 'zh-pinyin',
          },
        ],
        manualSort: undefined,
      });
    }
  );

  it('allows same-field pinyin sorting and grouping while manual sort is active', async () => {
    const onSortChange = vi.fn();
    const { unmount } = render(
      <SortBase
        group={[{ fieldId: 'fldName', order: SortFunc.Asc }]}
        sorts={{
          sortObjs: [{ fieldId: 'fldName', order: SortFunc.Asc }],
          manualSort: true,
        }}
        onChange={onSortChange}
      >
        <button type="button">Sort</button>
      </SortBase>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'sort.orderTitle' }));
    fireEvent.click(await screen.findByRole('option', { name: 'sort.pinyinASCLabel' }));

    expect(onSortChange).toHaveBeenCalledWith({
      sortObjs: [{ fieldId: 'fldName', order: SortFunc.Asc, collation: 'zh-pinyin' }],
      manualSort: true,
    });
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    unmount();

    const onGroupChange = vi.fn();
    mocks.viewSort = {
      sortObjs: [{ fieldId: 'fldName', order: SortFunc.Asc, collation: 'zh-pinyin' }],
      manualSort: true,
    };
    render(
      <Group group={null} onChange={onGroupChange}>
        {() => <button type="button">Group</button>}
      </Group>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Name' }));

    expect(onGroupChange).toHaveBeenCalledWith([{ fieldId: 'fldName', order: SortFunc.Asc }]);
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('keeps the existing group when its field already uses pinyin sorting', async () => {
    const onChange = vi.fn();
    mocks.viewSort = {
      sortObjs: [{ fieldId: 'fldName', order: SortFunc.Asc, collation: 'zh-pinyin' }],
    };
    render(
      <Group group={null} onChange={onChange}>
        {() => <button type="button">Group</button>}
      </Group>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Name' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith('group.pinyinSortConflict');
  });

  it('rejects adding a pinyin-sorted field after another group', async () => {
    const onChange = vi.fn();
    mocks.viewSort = {
      sortObjs: [{ fieldId: 'fldName', order: SortFunc.Desc, collation: 'zh-pinyin' }],
    };
    render(
      <Group group={[{ fieldId: 'fldCount', order: SortFunc.Asc }]} onChange={onChange}>
        {() => <button type="button">Group</button>}
      </Group>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(screen.getByRole('button', { name: 'group.addButton' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Name' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith('group.pinyinSortConflict');
  });

  it('rejects replacing an existing group with a pinyin-sorted field', async () => {
    const onChange = vi.fn();
    mocks.viewSort = {
      sortObjs: [{ fieldId: 'fldName', order: SortFunc.Asc, collation: 'zh-pinyin' }],
    };
    render(
      <Group group={[{ fieldId: 'fldCount', order: SortFunc.Desc }]} onChange={onChange}>
        {() => <button type="button">Group</button>}
      </Group>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(screen.getByText('Count'));
    fireEvent.click(await screen.findByRole('option', { name: 'Name' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith('group.pinyinSortConflict');
  });

  it('allows grouping the same field after pinyin sorting is removed', async () => {
    const onChange = vi.fn();
    mocks.viewSort = {
      sortObjs: [{ fieldId: 'fldName', order: SortFunc.Asc }],
    };
    render(
      <Group group={null} onChange={onChange}>
        {() => <button type="button">Group</button>}
      </Group>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Name' }));

    expect(onChange).toHaveBeenCalledWith([{ fieldId: 'fldName', order: SortFunc.Asc }]);
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});
