// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createContext, useContext, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import { SearchButton } from './SearchButton';

const state = vi.hoisted(() => ({
  tableId: 'tbl1',
  setValue: vi.fn(),
  setFieldId: vi.fn(),
  setHideNotMatchRow: vi.fn(),
  fields: [{ id: 'fld1', name: 'Name' }],
}));
const cancelDebounce = vi.hoisted(() => vi.fn());
const TestViewContext = createContext('viw1');
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useMutation: () => ({}),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@teable/sdk', () => ({
  LocalStorageKeys: {},
  useView: () => ({ id: useContext(TestViewContext), type: 'grid' }),
}));
vi.mock('@teable/sdk/hooks', () => ({
  useBaseId: () => 'bse1',
  useFields: () => state.fields,
  useRowCount: () => 0,
  useTableId: () => state.tableId,
  useTablePermission: () => ({}),
  useSearch: () => ({
    fieldId: 'all_fields',
    value: '',
    setValue: state.setValue,
    setFieldId: state.setFieldId,
    setHideNotMatchRow: state.setHideNotMatchRow,
  }),
}));
vi.mock('react-hotkeys-hook', () => ({ useHotkeys: vi.fn() }));
vi.mock('react-use', () => ({
  useLocalStorage: (_key: string, value: unknown) => useState(value),
  useDebounce: () => [false, cancelDebounce],
}));
vi.mock('@/features/app/hooks/useEnv', () => ({ useEnv: () => ({}) }));
vi.mock('./SearchCommand', () => ({ SearchCommand: () => null }));
vi.mock('./SearchCountPagination', () => ({ SearchCountPagination: () => null }));
vi.mock('../tool-bar/ToolBarButton', () => ({ ToolBarButton: () => <button>Search</button> }));

beforeEach(() => {
  vi.useFakeTimers();
  state.tableId = 'tbl1';
  useGridSearchStore.setState({ searchTarget: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('live palette search consumer', () => {
  it('mounts the existing input, transfers the query and focuses after palette focus restoration', () => {
    render(<SearchButton />);
    const target = useGridSearchStore.getState().searchTarget;
    expect(target).toMatchObject({ tableId: 'tbl1', viewId: 'viw1' });
    act(() => target?.open('customer@example.com'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('customer@example.com');
    const paletteTrigger = document.createElement('button');
    document.body.appendChild(paletteTrigger);
    // Focus restoration dispatches blur; flush its input-key remount before the timer.
    act(() => paletteTrigger.focus());
    const mountedInput = screen.getByRole('textbox') as HTMLInputElement;
    act(() => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(mountedInput);
    expect(mountedInput.value).toBe('customer@example.com');
    expect(mountedInput.selectionStart).toBe(0);
    expect(mountedInput.selectionEnd).toBe(mountedInput.value.length);
    paletteTrigger.remove();
  });

  it('unregisters on unmount and does not replay an earlier search on remount', () => {
    const first = render(<SearchButton />);
    act(() => useGridSearchStore.getState().searchTarget?.open('old query'));
    first.unmount();
    expect(useGridSearchStore.getState().searchTarget).toBeNull();
    render(<SearchButton />);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('updates registration on view change without allowing old cleanup to remove the new consumer', () => {
    const first = render(
      <TestViewContext.Provider value="viw1">
        <SearchButton />
      </TestViewContext.Provider>
    );
    const second = render(
      <TestViewContext.Provider value="viw2">
        <SearchButton />
      </TestViewContext.Provider>
    );
    expect(useGridSearchStore.getState().searchTarget?.viewId).toBe('viw2');
    first.unmount();
    expect(useGridSearchStore.getState().searchTarget?.viewId).toBe('viw2');
    second.unmount();
    expect(useGridSearchStore.getState().searchTarget).toBeNull();
  });

  it('does not register shared-view search as a project command consumer', () => {
    render(<SearchButton shareView />);
    expect(useGridSearchStore.getState().searchTarget).toBeNull();
  });
});
