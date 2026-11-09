import { SortFunc, ViewType } from '@teable/core';
import type { IGroup, ISort } from '@teable/core';
import type * as UiLib from '@teable/ui-lib';
import { act, cleanup, render } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IViewInstance } from '../../model/view/factory';
import { PersonalViewProxy, type IProxyPersonalView } from './PersonalViewProxy';
import { ViewContext } from './ViewContext';

const mocks = vi.hoisted(() => ({
  view: undefined as IViewInstance | undefined,
  cache: {} as Record<string, Record<string, unknown>>,
  setPersonalViewMap: vi.fn(),
  setCollapsedGroupMap: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@teable/ui-lib', async (importOriginal) => ({
  ...(await importOriginal<typeof UiLib>()),
  sonner: { toast: { warning: mocks.toastWarning } },
}));
vi.mock('../app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks', () => ({
  useViews: () => (mocks.view ? [mocks.view] : []),
  useTableId: () => 'tblPersonalView',
}));
vi.mock('../../components', () => ({
  generateLocalId: () => 'tblPersonalView_viwPersonalView',
  useGridCollapsedGroupStore: () => ({ setCollapsedGroupMap: mocks.setCollapsedGroupMap }),
}));
vi.mock('./store', () => ({
  useResolvedPersonalViewStore: () => ({
    personalViewMap: mocks.cache,
    isPersonalView: () => true,
    setPersonalViewMap: mocks.setPersonalViewMap,
  }),
}));

let proxy: IProxyPersonalView;
const ProxyProbe = () => {
  proxy = useContext(ViewContext).views[0] as IProxyPersonalView;
  return null;
};
const pinyinSort: ISort = {
  sortObjs: [{ fieldId: 'fldName', order: SortFunc.Desc, collation: 'zh-pinyin' }],
  manualSort: false,
};
const defaultSort: ISort = {
  sortObjs: [{ fieldId: 'fldName', order: SortFunc.Desc }],
  manualSort: false,
};
const nameGroup: IGroup = [{ fieldId: 'fldName', order: SortFunc.Asc }];

const renderProxy = () =>
  render(
    <PersonalViewProxy>
      <ProxyProbe />
    </PersonalViewProxy>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.view = {
    id: 'viwPersonalView',
    tableId: 'tblPersonalView',
    type: ViewType.Grid,
    columnMeta: {},
    updateFilter: vi.fn(),
    updateSort: vi.fn().mockResolvedValue(undefined),
    updateGroup: vi.fn().mockResolvedValue(undefined),
    updateOption: vi.fn(),
    updateColumnMeta: vi.fn(),
  } as unknown as IViewInstance;
  mocks.cache = {
    viwPersonalView: {
      id: 'viwPersonalView',
      type: ViewType.Grid,
      columnMeta: {},
    },
  };
  mocks.setPersonalViewMap.mockImplementation((viewId, updater) => {
    mocks.cache[viewId] = updater(mocks.cache[viewId]);
  });
});
afterEach(cleanup);

describe('personal view sort/group changes', () => {
  it('rejects pinyin using the latest local group without overwriting either saved property', () => {
    renderProxy();
    act(() => {
      proxy.updateGroup(nameGroup);
      proxy.updateSort(pinyinSort);
    });

    expect(mocks.cache.viwPersonalView.group).toEqual(nameGroup);
    expect(mocks.cache.viwPersonalView.sort).toBeUndefined();
    expect(mocks.toastWarning).toHaveBeenCalledWith('sort.pinyinGroupConflict');
    expect(mocks.view?.updateSort).not.toHaveBeenCalled();
  });

  it('rejects a same-field group using the latest local sort and allows retry after default sorting', () => {
    renderProxy();
    act(() => {
      proxy.updateSort(pinyinSort);
      proxy.updateGroup(nameGroup);
    });

    expect(mocks.cache.viwPersonalView.sort).toEqual(pinyinSort);
    expect(mocks.cache.viwPersonalView.group).toBeUndefined();
    expect(mocks.setCollapsedGroupMap).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith('group.pinyinSortConflict');

    act(() => {
      proxy.updateSort(defaultSort);
      proxy.updateGroup(nameGroup);
    });
    expect(mocks.cache.viwPersonalView.sort).toEqual(defaultSort);
    expect(mocks.cache.viwPersonalView.group).toEqual(nameGroup);
    expect(mocks.setCollapsedGroupMap).toHaveBeenCalledTimes(1);
  });

  it('allows a same-field pinyin sort and group in personal manual-sort mode', () => {
    const manualPinyinSort: ISort = { ...pinyinSort, manualSort: true };
    renderProxy();
    act(() => {
      proxy.updateGroup(nameGroup);
      proxy.updateSort(manualPinyinSort);
    });

    expect(mocks.cache.viwPersonalView.group).toEqual(nameGroup);
    expect(mocks.cache.viwPersonalView.sort).toEqual(manualPinyinSort);
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('exposes a safe restored pair while keeping cached grouping, sort direction and unrelated preferences', () => {
    const filter = { conjunction: 'and', filterSet: [] };
    mocks.cache.viwPersonalView = {
      ...mocks.cache.viwPersonalView,
      sort: pinyinSort,
      group: nameGroup,
      filter,
    };
    renderProxy();

    expect(proxy.sort).toEqual(defaultSort);
    expect(proxy.group).toEqual(nameGroup);
    expect(proxy.filter).toEqual(filter);
    expect(mocks.view?.sort).toBeUndefined();
    expect(mocks.view?.group).toBeUndefined();
  });

  it('removes saved grouping before syncing newly enabled pinyin sorting', async () => {
    const operations: string[] = [];
    mocks.view!.group = nameGroup;
    mocks.view!.sort = defaultSort;
    vi.mocked(mocks.view!.updateGroup).mockImplementation(async () => {
      operations.push('group');
      return undefined as never;
    });
    vi.mocked(mocks.view!.updateSort).mockImplementation(async () => {
      operations.push('sort');
      return undefined as never;
    });
    mocks.cache.viwPersonalView = {
      ...mocks.cache.viwPersonalView,
      sort: pinyinSort,
      group: null,
    };
    renderProxy();

    await act(async () => proxy.syncViewProperties?.());

    expect(operations).toEqual(['group', 'sort']);
    expect(mocks.view!.updateGroup).toHaveBeenCalledWith(null);
    expect(mocks.view!.updateSort).toHaveBeenCalledWith(pinyinSort);
  });

  it('changes saved pinyin sorting before syncing a new same-field group', async () => {
    const operations: string[] = [];
    mocks.view!.sort = pinyinSort;
    vi.mocked(mocks.view!.updateSort).mockImplementation(async () => {
      operations.push('sort');
      return undefined as never;
    });
    vi.mocked(mocks.view!.updateGroup).mockImplementation(async () => {
      operations.push('group');
      return undefined as never;
    });
    mocks.cache.viwPersonalView = {
      ...mocks.cache.viwPersonalView,
      sort: defaultSort,
      group: nameGroup,
    };
    renderProxy();

    await act(async () => proxy.syncViewProperties?.());

    expect(operations).toEqual(['sort', 'group']);
    expect(mocks.view!.updateSort).toHaveBeenCalledWith(defaultSort);
    expect(mocks.view!.updateGroup).toHaveBeenCalledWith(nameGroup);
  });

  it('keeps every intermediate pair valid when swapping grouped and pinyin-sorted fields', async () => {
    let savedSort: ISort = pinyinSort;
    let savedGroup: IGroup = [{ fieldId: 'fldOther', order: SortFunc.Asc }];
    const nextSort: ISort = {
      sortObjs: [{ fieldId: 'fldOther', order: SortFunc.Asc, collation: 'zh-pinyin' }],
      manualSort: false,
    };
    mocks.view!.sort = savedSort;
    mocks.view!.group = savedGroup;
    const transitions: { sort: ISort; group: IGroup }[] = [];
    vi.mocked(mocks.view!.updateSort).mockImplementation(async (sort) => {
      savedSort = sort;
      transitions.push({ sort: savedSort, group: savedGroup });
      return undefined as never;
    });
    vi.mocked(mocks.view!.updateGroup).mockImplementation(async (group) => {
      savedGroup = group;
      transitions.push({ sort: savedSort, group: savedGroup });
      return undefined as never;
    });
    mocks.cache.viwPersonalView = {
      ...mocks.cache.viwPersonalView,
      sort: nextSort,
      group: nameGroup,
    };
    renderProxy();

    await act(async () => proxy.syncViewProperties?.());

    expect(transitions).toEqual([
      { sort: defaultSort, group: [{ fieldId: 'fldOther', order: SortFunc.Asc }] },
      { sort: defaultSort, group: nameGroup },
      { sort: nextSort, group: nameGroup },
    ]);
  });
});
