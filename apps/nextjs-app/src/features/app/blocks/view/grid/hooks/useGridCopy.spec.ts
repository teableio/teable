import { CellValueType, DbFieldType, FieldType, Relationship } from '@teable/core';
import type { ICopyVo } from '@teable/openapi';
import type { Field, IRecordIndexMap } from '@teable/sdk';
import { CombinedSelection, SelectionRegionType } from '@teable/sdk';
import type * as UiLib from '@teable/ui-lib';
import { act, renderHook } from '@testing-library/react';
import type { ClipboardEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSyncCopyData } from '../utils/getSyncCopyData';
import { useGridCopy } from './useGridCopy';

const { confirm, warning } = vi.hoisted(() => ({ confirm: vi.fn(), warning: vi.fn() }));
vi.mock('@teable/ui-lib', async (importOriginal) => ({
  ...(await importOriginal<typeof UiLib>()),
  useConfirm: () => ({ confirm }),
}));
vi.mock('@teable/ui-lib/shadcn/ui/sonner', () => ({ toast: { warning } }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const owner = { id: 'usrAllowed', title: 'Alice', email: 'alice@example.com' };
const foreignLink = { id: 'recForeign', title: 'Foreign record' };
const userField = {
  id: 'fldUser1111111111',
  name: 'Owner',
  dbFieldName: 'owner',
  type: FieldType.User,
  options: { isMultiple: false, shouldNotify: false },
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Json,
  isMultipleCellValue: false,
  cellValue2String: (value: { title?: string } | null) => value?.title ?? '',
} as unknown as Field;
const linkField = {
  ...userField,
  id: 'fldLink1111111111',
  name: 'Linked',
  dbFieldName: 'linked',
  type: FieldType.Link,
  options: {
    baseId: 'bseForeign',
    relationship: Relationship.ManyOne,
    foreignTableId: 'tblForeign',
    lookupFieldId: 'fldForeign',
    fkHostTableName: 'source',
    selfKeyName: '__id',
    foreignKeyName: '__fk',
  },
} as unknown as Field;
const fields = [userField, linkField];
const fieldValueMap = { [userField.id]: owner, [linkField.id]: foreignLink };
const selection = new CombinedSelection(SelectionRegionType.Cells, [
  [0, 0],
  [1, 0],
]);

const setup = () => {
  const written: ICopyVo[] = [];
  const copy = vi.fn(
    async (_selection: CombinedSelection, getCopyData?: () => Promise<ICopyVo>) => {
      if (getCopyData) written.push(await getCopyData());
    }
  );
  const syncCopy = vi.fn(
    (
      _event: ClipboardEvent,
      params:
        | { getCopyData: () => ICopyVo }
        | { selection: CombinedSelection; recordMap: IRecordIndexMap; rowCount: number }
    ) => {
      if ('getCopyData' in params) written.push(params.getCopyData());
      else {
        const { headers, ...data } = getSyncCopyData({ ...params, fields });
        written.push({ ...data, header: headers });
      }
    }
  );
  const event = { preventDefault: vi.fn() } as unknown as ClipboardEvent;
  const options = {
    fields,
    baseId: 'bseCurrent',
    shareId: 'shrEditableBase',
    canCopy: true,
    // Presort/prefilling rows have their own values, not entries in the main viewport map.
    recordMap: {} as IRecordIndexMap,
    rowCount: 0,
    copy,
    syncCopy,
    captureSelection: vi.fn(),
  };
  return { written, copy, syncCopy, event, options };
};

describe('shared grid single-row clipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirm.mockResolvedValue(true);
  });

  it('downgrades a confirmed presort cross-base link without losing the loaded user pair or text', async () => {
    const { written, event, options, syncCopy } = setup();
    const { result } = renderHook(() => useGridCopy(options));

    await act(() => result.current.onCopyForSingleRow(event, selection, fieldValueMap));

    expect(written).toHaveLength(1);
    expect(written[0].content).toBe('Alice\tForeign record');
    expect(written[0].rawContent?.[0]?.[0]).toEqual(owner);
    expect(written[0].rawContent?.[0]?.[1]).toBe('Foreign record');
    expect(written[0].header?.[1].type).toBe(FieldType.SingleLineText);
    expect(written[0].header?.[1].options).toEqual({});
    expect(JSON.stringify(written[0])).not.toContain('recForeign');
    expect(confirm).toHaveBeenCalledWith({
      title: 'table:table.actionTips.crossBaseCopyTitle',
      description: 'table:table.actionTips.crossBaseCopyDescription',
      confirmText: 'table:table.actionTips.crossBaseCopyConfirm',
      cancelText: 'common:actions.cancel',
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(syncCopy).not.toHaveBeenCalled();
  });

  it('writes nothing while confirmation is pending or after cancellation', async () => {
    const { promise, resolve: resolveConfirmation } = Promise.withResolvers<boolean>();
    confirm.mockReturnValueOnce(promise);
    const { written, event, options, syncCopy, copy } = setup();
    const { result } = renderHook(() => useGridCopy(options));

    const copying = result.current.onCopyForSingleRow(event, selection, fieldValueMap);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    expect(written).toEqual([]);
    expect(syncCopy).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    resolveConfirmation(false);
    await act(() => copying);
    expect(written).toEqual([]);
    expect(copy).not.toHaveBeenCalled();
  });

  it('enforces the same copy permission for a single row', async () => {
    const { written, event, options } = setup();
    const { result } = renderHook(() => useGridCopy({ ...options, canCopy: false }));

    await act(() => result.current.onCopyForSingleRow(event, selection, fieldValueMap));

    expect(written).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('table:table.actionTips.copyError.noPermission');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('copies only selected fields without prompting for an unselected cross-base field', async () => {
    const { written, event, options, syncCopy } = setup();
    const { result } = renderHook(() => useGridCopy(options));
    const userOnly = new CombinedSelection(SelectionRegionType.Cells, [
      [0, 0],
      [0, 0],
    ]);

    await act(() => result.current.onCopyForSingleRow(event, userOnly, fieldValueMap));

    expect(confirm).not.toHaveBeenCalled();
    expect(syncCopy).toHaveBeenCalledOnce();
    expect(written[0].content).toBe('Alice');
    expect(written[0].rawContent).toEqual([[owner]]);
    expect(written[0].header).toHaveLength(1);
  });

  it('does not enrich an email-less user when downgrading a shared link', async () => {
    const { written, event, options } = setup();
    const { result } = renderHook(() => useGridCopy(options));
    const userWithoutEmail = { id: 'usrMissing', title: 'Missing email' };

    await act(() =>
      result.current.onCopyForSingleRow(event, selection, {
        ...fieldValueMap,
        [userField.id]: userWithoutEmail,
      })
    );

    expect(written[0].rawContent).toEqual([[userWithoutEmail, 'Foreign record']]);
    expect(written[0].rawContent?.[0]?.[0]).not.toHaveProperty('email');
    expect(written[0].content).toBe('Missing email\tForeign record');
  });

  it('keeps workspace single-row link data unchanged', async () => {
    const { written, event, options, syncCopy } = setup();
    const { result } = renderHook(() => useGridCopy({ ...options, shareId: undefined }));

    await act(() => result.current.onCopyForSingleRow(event, selection, fieldValueMap));

    expect(confirm).not.toHaveBeenCalled();
    expect(syncCopy).toHaveBeenCalledOnce();
    expect(written[0].rawContent).toEqual([[owner, foreignLink]]);
    expect(written[0].header?.[1].type).toBe(FieldType.Link);
  });

  it.each(['keyboard', 'context menu'] as const)(
    'retains normal shared %s confirmation and downgrade without an anchor base',
    async (source) => {
      const { written, event, options, syncCopy } = setup();
      const recordMap = {
        0: { id: 'recSource', fields: fieldValueMap },
      } as unknown as IRecordIndexMap;
      const { result } = renderHook(() =>
        useGridCopy({
          ...options,
          baseId: undefined,
          recordMap,
          rowCount: 1,
        })
      );

      await act(() => result.current.onCopy(selection, source === 'keyboard' ? event : undefined));

      expect(confirm).toHaveBeenCalledOnce();
      expect(syncCopy).not.toHaveBeenCalled();
      expect(written[0].content).toBe('Alice\tForeign record');
      expect(written[0].rawContent).toEqual([[owner, 'Foreign record']]);
      expect(written[0].header?.[1].type).toBe(FieldType.SingleLineText);
    }
  );

  it('falls back to server copy when cached selection endpoints surround a missing row', async () => {
    const { written, copy, syncCopy, event, options } = setup();
    const sparseSelection = new CombinedSelection(SelectionRegionType.Cells, [
      [0, 0],
      [0, 2],
    ]);
    const sparseRecordMap = {
      0: { id: 'rec0', fields: { [userField.id]: owner } },
      2: { id: 'rec2', fields: { [userField.id]: owner } },
    } as unknown as IRecordIndexMap;
    const { result } = renderHook(() =>
      useGridCopy({ ...options, recordMap: sparseRecordMap, rowCount: 3 })
    );

    await act(() => result.current.onCopy(sparseSelection, event));

    expect(syncCopy).not.toHaveBeenCalled();
    expect(copy).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledWith(sparseSelection, undefined, sparseRecordMap);
    expect(options.captureSelection).toHaveBeenCalledWith(sparseSelection);
    expect(written).toEqual([]);
  });

  it('still refuses an unloaded normal shared selection before confirmation', async () => {
    const { written, event, options } = setup();
    const { result } = renderHook(() => useGridCopy(options));

    await act(() => result.current.onCopy(selection, event));

    expect(written).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('table:table.actionTips.crossBaseCopyLoadFirst');
  });
});
