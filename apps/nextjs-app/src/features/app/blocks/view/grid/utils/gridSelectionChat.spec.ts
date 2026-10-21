import { QueryClient } from '@tanstack/react-query';
import { CombinedSelection, SelectionRegionType } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config';
import { describe, expect, it, vi } from 'vitest';
import type { IGridSelectionCaptureData } from './gridSelectionChat';
import {
  cacheRecordForChat,
  cacheSelectionForChat,
  cancelGridSelectionCapture,
  GridSelectionType,
  resolveGridSelectionForChat,
} from './gridSelectionChat';

vi.mock('@/features/app/components/sidebar/useChatPanelStore', () => ({
  useChatPanelStore: { getState: () => ({ open: vi.fn(), requestMobileOpen: vi.fn() }) },
}));
const cell = (column = 0, end = 0) =>
  new CombinedSelection(SelectionRegionType.Cells, [
    [column, 0],
    [column, end],
  ]);
const options = (rowCount = 3) => ({
  tableId: 'tblSource',
  viewId: 'viwSource',
  tableName: 'Source',
  rowCount,
  fields: ['Detail', 'Title'].map((id) => ({ id })),
  recordMap: Object.fromEntries(Array.from({ length: rowCount }, (_, i) => [i, { id: `rec${i}` }])),
  loadRecordIds: vi.fn<(ranges: [number, number][]) => Promise<string[]>>(),
});

describe('stable selection capture', () => {
  it('captures all 22 IDs and fields synchronously before models or columns mutate', () => {
    const source = options(22);
    const captured = resolveGridSelectionForChat(cell(0, 21), source);
    source.recordMap[0].id = 'replacement';
    source.fields.reverse();
    expect(captured).not.toBeInstanceOf(Promise);
    expect(captured).toMatchObject({
      tableName: 'Source',
      fieldIds: ['Detail'],
      recordIds: Array.from({ length: 22 }, (_, i) => `rec${i}`),
    });
    expect(source.loadRecordIds).not.toHaveBeenCalled();
  });
  it('resolves normalized disjoint ranges in full, not a loaded subset or query-wide shortcut', async () => {
    const source = options(5);
    delete source.recordMap[3];
    source.loadRecordIds.mockResolvedValue(['rec0', 'rec1', 'rec3', 'rec4']);
    const captured = await resolveGridSelectionForChat(
      new CombinedSelection(SelectionRegionType.Rows, [
        [4, 3],
        [1, 0],
        [0, 1],
      ]),
      source
    );
    expect(source.loadRecordIds).toHaveBeenCalledWith([
      [0, 1],
      [3, 4],
    ]);
    expect(captured.recordIds).toEqual(['rec0', 'rec1', 'rec3', 'rec4']);
  });
  it.each([
    { ids: ['rec0', 'rec2'] },
    { ids: ['rec0', 'rec0', 'rec2'] },
    { ids: ['other', 'rec1', 'rec2'] },
  ])('rejects incomplete, duplicate or drifted IDs: $ids', async ({ ids }) => {
    const source = options();
    delete source.recordMap[1];
    source.loadRecordIds.mockResolvedValue(ids);
    await expect(resolveGridSelectionForChat(cell(0, 2), source)).rejects.toThrow(
      'Selection changed'
    );
  });
  it('uses the visible row count for columns, including empty views', () => {
    const source = options();
    source.rowCount = 2;
    const columns = new CombinedSelection(SelectionRegionType.Columns, [[1, 0]]);
    expect(resolveGridSelectionForChat(columns, source)).toMatchObject({
      recordIds: ['rec0', 'rec1'],
      fieldIds: ['Detail', 'Title'],
    });
    source.rowCount = 0;
    expect(resolveGridSelectionForChat(columns, source)).toMatchObject({ recordIds: [] });
  });
});

describe('capture intents', () => {
  const captured: IGridSelectionCaptureData = {
    selectionType: GridSelectionType.Rows,
    tableId: 'tblSource',
    recordIds: ['rec0'],
  };
  it.each(['new capture', 'paste'])('ignores a pending response after %s', async (action) => {
    const client = new QueryClient();
    const key = ReactQueryKeys.gridSelection('base');
    cacheSelectionForChat(client, 'base', captured, false);
    cancelGridSelectionCapture(client, 'base');
    expect(client.getQueryData(key)).toMatchObject(captured);
    let resolve!: (value: IGridSelectionCaptureData) => void;
    const pending = cacheSelectionForChat(
      client,
      'base',
      new Promise<IGridSelectionCaptureData>((done) => {
        resolve = done;
      }),
      true
    );
    expect(client.getQueryData(key)).toBeUndefined();
    if (action === 'paste') cancelGridSelectionCapture(client, 'base');
    else cacheRecordForChat(client, 'base', { tableId: 'linked', recordId: 'new' });
    resolve(captured);
    await pending;
    if (action === 'paste') expect(client.getQueryData(key)).toBeUndefined();
    else
      expect(client.getQueryData(key)).toMatchObject({
        tableId: 'linked',
        recordIds: ['new'],
        addToChat: true,
      });
  });
  it('propagates a current failure without retaining the old reference', async () => {
    const client = new QueryClient();
    cacheSelectionForChat(client, 'base', captured, false);
    await expect(
      cacheSelectionForChat(client, 'base', Promise.reject(new Error('Denied')), true)
    ).rejects.toThrow('Denied');
    expect(client.getQueryData(ReactQueryKeys.gridSelection('base'))).toBeUndefined();
  });
});
