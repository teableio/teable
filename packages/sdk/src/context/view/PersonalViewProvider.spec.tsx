import { CellValueType, FieldType, SortFunc, ViewType } from '@teable/core';
import type { IFieldVo, IViewVo } from '@teable/core';
import type * as UiLib from '@teable/ui-lib';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalViewContext } from './PersonalViewContext';
import { PersonalViewProvider } from './PersonalViewProvider';

const mocks = vi.hoisted(() => ({
  fields: [] as IFieldVo[],
  cachedView: undefined as IViewVo | undefined,
  tableListener: undefined as
    | ((actionKey: string, payload?: Record<string, unknown>) => void)
    | undefined,
  setPersonalViewMap: vi.fn(),
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
  useFields: () => mocks.fields,
  useTableId: () => 'tblPersonalView',
  useTableListener: (
    _tableId: string,
    _actionKeys: string[],
    listener: (actionKey: string, payload?: Record<string, unknown>) => void
  ) => {
    mocks.tableListener = listener;
  },
  useView: () => ({ id: 'viwPersonalView' }),
}));

vi.mock('./store', () => ({
  useResolvedPersonalViewStore: () => ({
    personalViewMap: mocks.cachedView
      ? { viwPersonalView: mocks.cachedView as unknown as Record<string, unknown> }
      : {},
    setPersonalViewMap: mocks.setPersonalViewMap,
  }),
}));

const createField = (
  id: string,
  type: FieldType,
  cellValueType: CellValueType,
  isMultipleCellValue = false
) =>
  ({
    id,
    name: id,
    type,
    cellValueType,
    isMultipleCellValue,
  }) as IFieldVo;

const createPersonalView = (
  sortObjs: NonNullable<IViewVo['sort']>['sortObjs'],
  manualSort = false
) =>
  ({
    id: 'viwPersonalView',
    type: ViewType.Grid,
    sort: { sortObjs, manualSort },
  }) as IViewVo;

const QueryProbe = () => {
  const { personalViewCommonQuery, personalViewAggregationQuery } = useContext(PersonalViewContext);
  return (
    <>
      <output data-testid="order-by">
        {JSON.stringify(personalViewCommonQuery?.orderBy) ?? 'null'}
      </output>
      <output data-testid="group-by">{JSON.stringify(personalViewCommonQuery?.groupBy)}</output>
      <output data-testid="filter">
        {JSON.stringify(personalViewCommonQuery?.filter) ?? 'null'}
      </output>
      <output data-testid="aggregation-group-by">
        {JSON.stringify(personalViewAggregationQuery?.groupBy)}
      </output>
    </>
  );
};

describe('PersonalViewProvider sort collation cleanup', () => {
  beforeEach(() => {
    mocks.fields = [];
    mocks.cachedView = undefined;
    mocks.tableListener = undefined;
    mocks.setPersonalViewMap.mockReset();
    mocks.toastWarning.mockReset();
    mocks.setPersonalViewMap.mockImplementation((_viewId, updater) => {
      mocks.cachedView = updater(mocks.cachedView as IViewVo) as IViewVo;
    });
  });

  afterEach(cleanup);

  it('reloads a personal view without an unsupported cached collation', async () => {
    mocks.fields = [
      createField('fldCount', FieldType.Number, CellValueType.Number),
      createField('fldName', FieldType.SingleLineText, CellValueType.String),
    ];
    mocks.cachedView = createPersonalView([
      { fieldId: 'fldCount', order: SortFunc.Desc, collation: 'zh-pinyin' },
      { fieldId: 'fldName', order: SortFunc.Asc, collation: 'zh-pinyin' },
    ]);

    render(
      <PersonalViewProvider>
        <QueryProbe />
      </PersonalViewProvider>
    );

    expect(JSON.parse(screen.getByTestId('order-by').textContent ?? 'null')).toEqual([
      { fieldId: 'fldCount', order: SortFunc.Desc },
      { fieldId: 'fldName', order: SortFunc.Asc, collation: 'zh-pinyin' },
    ]);
    await waitFor(() => expect(mocks.setPersonalViewMap).toHaveBeenCalledTimes(1));
    expect(mocks.cachedView?.sort?.sortObjs).toEqual([
      { fieldId: 'fldCount', order: SortFunc.Desc },
      { fieldId: 'fldName', order: SortFunc.Asc, collation: 'zh-pinyin' },
    ]);
  });

  it('removes collation when a personal-view link field becomes multiple', () => {
    const linkField = createField('fldLink', FieldType.Link, CellValueType.String);
    mocks.fields = [linkField];
    mocks.cachedView = createPersonalView([
      { fieldId: 'fldLink', order: SortFunc.Desc, collation: 'zh-pinyin' },
    ]);

    render(
      <PersonalViewProvider>
        <QueryProbe />
      </PersonalViewProvider>
    );
    expect(mocks.setPersonalViewMap).not.toHaveBeenCalled();

    act(() => {
      mocks.tableListener?.('setField', {
        field: { ...linkField, isMultipleCellValue: true },
      });
    });

    expect(mocks.cachedView?.sort?.sortObjs).toEqual([
      { fieldId: 'fldLink', order: SortFunc.Desc },
    ]);
  });

  it('recovers a cached same-field group conflict before fields load', async () => {
    mocks.cachedView = {
      ...createPersonalView([{ fieldId: 'fldName', order: SortFunc.Desc, collation: 'zh-pinyin' }]),
      group: [{ fieldId: 'fldName', order: SortFunc.Asc }],
    } as IViewVo;

    render(
      <PersonalViewProvider>
        <QueryProbe />
      </PersonalViewProvider>
    );

    expect(JSON.parse(screen.getByTestId('order-by').textContent ?? 'null')).toEqual([
      { fieldId: 'fldName', order: SortFunc.Desc },
    ]);
    expect(JSON.parse(screen.getByTestId('group-by').textContent ?? 'null')).toEqual([
      { fieldId: 'fldName', order: SortFunc.Asc },
    ]);
    expect(JSON.parse(screen.getByTestId('aggregation-group-by').textContent ?? 'null')).toEqual([
      { fieldId: 'fldName', order: SortFunc.Asc },
    ]);
    await waitFor(() => expect(mocks.setPersonalViewMap).toHaveBeenCalledTimes(1));
    expect(mocks.cachedView?.sort?.sortObjs).toEqual([
      { fieldId: 'fldName', order: SortFunc.Desc },
    ]);
    expect(mocks.cachedView?.group).toEqual([{ fieldId: 'fldName', order: SortFunc.Asc }]);
    expect(mocks.toastWarning).toHaveBeenCalledWith('sort.pinyinGroupRecovered');
  });

  it('keeps a cached same-field pinyin collation when manual sort is active', () => {
    mocks.fields = [createField('fldName', FieldType.SingleLineText, CellValueType.String)];
    mocks.cachedView = {
      ...createPersonalView(
        [{ fieldId: 'fldName', order: SortFunc.Desc, collation: 'zh-pinyin' }],
        true
      ),
      group: [{ fieldId: 'fldName', order: SortFunc.Asc }],
    } as IViewVo;

    render(
      <PersonalViewProvider>
        <QueryProbe />
      </PersonalViewProvider>
    );

    expect(JSON.parse(screen.getByTestId('order-by').textContent ?? 'null')).toBeNull();
    expect(JSON.parse(screen.getByTestId('group-by').textContent ?? 'null')).toEqual([
      { fieldId: 'fldName', order: SortFunc.Asc },
    ]);
    expect(mocks.cachedView?.sort?.sortObjs).toEqual([
      { fieldId: 'fldName', order: SortFunc.Desc, collation: 'zh-pinyin' },
    ]);
    expect(mocks.setPersonalViewMap).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('removes a stale text filter after its field is restored as a number', async () => {
    mocks.fields = [createField('fldValue', FieldType.Number, CellValueType.Number)];
    mocks.cachedView = {
      ...createPersonalView([]),
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fldValue', operator: 'contains', value: '12' }],
      },
    } as IViewVo;

    render(
      <PersonalViewProvider>
        <QueryProbe />
      </PersonalViewProvider>
    );

    expect(JSON.parse(screen.getByTestId('filter').textContent ?? 'null')).toBeNull();
    await waitFor(() => expect(mocks.setPersonalViewMap).toHaveBeenCalledTimes(1));
    expect(mocks.cachedView?.filter).toBeNull();
  });

  it('preserves a cached symbolic filter during full cache validation', () => {
    const filter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldValue', isSymbol: true, operator: '=', value: 12 }],
    } as NonNullable<IViewVo['filter']>;
    mocks.fields = [createField('fldValue', FieldType.Number, CellValueType.Number)];
    mocks.cachedView = { ...createPersonalView([]), filter } as IViewVo;

    render(
      <PersonalViewProvider>
        <QueryProbe />
      </PersonalViewProvider>
    );

    expect(JSON.parse(screen.getByTestId('filter').textContent ?? 'null')).toEqual(filter);
    expect(mocks.cachedView?.filter).toEqual(filter);
  });

  it('preserves a cached select field-reference filter', () => {
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldStatus',
          operator: 'is',
          value: { type: 'field', fieldId: 'fldOtherStatus' },
        },
      ],
    } as NonNullable<IViewVo['filter']>;
    const selectOptions = {
      choices: [{ id: 'choOpen', name: 'Open', color: 'blue' }],
    };
    mocks.fields = [
      {
        ...createField('fldStatus', FieldType.SingleSelect, CellValueType.String),
        options: selectOptions,
      },
      {
        ...createField('fldOtherStatus', FieldType.SingleSelect, CellValueType.String),
        options: selectOptions,
      },
    ] as IFieldVo[];
    mocks.cachedView = { ...createPersonalView([]), filter } as IViewVo;

    render(
      <PersonalViewProvider>
        <QueryProbe />
      </PersonalViewProvider>
    );

    expect(JSON.parse(screen.getByTestId('filter').textContent ?? 'null')).toEqual(filter);
    expect(mocks.cachedView?.filter).toEqual(filter);
  });

  it.each([
    [FieldType.CreatedTime, 'fldCreatedTime'],
    [FieldType.LastModifiedTime, 'fldModifiedTime'],
    [FieldType.Formula, 'fldFormulaDate'],
  ])('preserves a cached calendar %s datetime field', (fieldType, fieldId) => {
    const options = {
      startDateFieldId: fieldId,
      endDateFieldId: fieldId,
    };
    mocks.fields = [createField(fieldId, fieldType as FieldType, CellValueType.DateTime)];
    mocks.cachedView = {
      ...createPersonalView([]),
      type: ViewType.Calendar,
      options,
    } as IViewVo;

    render(
      <PersonalViewProvider>
        <QueryProbe />
      </PersonalViewProvider>
    );

    expect(mocks.cachedView?.options).toEqual(options);
  });

  it.each(['isAnyOf', 'isNoneOf'])(
    'preserves a cached single-select %s array filter during full cache validation',
    (operator) => {
      const filter = {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fldStatus', operator, value: ['Open', 'Closed'] }],
      } as NonNullable<IViewVo['filter']>;
      mocks.fields = [
        {
          ...createField('fldStatus', FieldType.SingleSelect, CellValueType.String),
          options: {
            choices: [
              { id: 'choOpen', name: 'Open', color: 'blue' },
              { id: 'choClosed', name: 'Closed', color: 'green' },
            ],
          },
        } as IFieldVo,
      ];
      mocks.cachedView = {
        ...createPersonalView([]),
        filter,
      } as IViewVo;

      render(
        <PersonalViewProvider>
          <QueryProbe />
        </PersonalViewProvider>
      );

      expect(JSON.parse(screen.getByTestId('filter').textContent ?? 'null')).toEqual(filter);
      expect(mocks.cachedView?.filter).toEqual(filter);
    }
  );
});
