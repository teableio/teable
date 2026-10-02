import type { IGetRecordsRo } from '@teable/openapi';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { Connection } from 'sharedb/lib/client';
import { describe, expect, it, vi } from 'vitest';
import { useConnection } from '../../../hooks/use-connection';
import { useGridViewCacheStore } from '../store/useGridViewCacheStore';
import { useGridAsyncRecords } from './use-grid-async-records';

const { fields, view, search } = vi.hoisted(() => ({
  fields: [],
  view: { id: 'viwScroll' },
  search: {},
}));

vi.mock('../../../hooks', () => ({
  useFields: () => fields,
  useView: () => view,
  useTableId: () => 'tblScroll',
  usePersonalView: () => ({ isPersonalView: false }),
  useSearch: () => search,
}));
vi.mock('../../../hooks/use-fields', () => ({ useFields: () => fields }));
vi.mock('../../../hooks/use-view', () => ({ useView: () => view }));
vi.mock('../../../hooks/use-view-id', () => ({ useViewId: () => view.id }));
vi.mock('../../../hooks/use-table-id', () => ({ useTableId: () => 'tblScroll' }));
vi.mock('../../../hooks/use-search', () => ({ useSearch: () => search }));
vi.mock('../../../hooks/use-connection', () => ({ useConnection: vi.fn() }));

// Keep the real ShareDB client and both record hooks. Only server transport is
// controlled, so a new window can remain pending while the grid renders.
const createTransport = () => {
  const subscriptions: Array<{ a: string; id: number; q: IGetRecordsRo }> = [];
  const socket = {
    readyState: 1,
    send: (raw: string) => {
      const message = JSON.parse(raw);
      if (message.a === 'qs') subscriptions.push(message);
    },
    close: vi.fn(),
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
  };
  const connection = new Connection(
    socket as unknown as ConstructorParameters<typeof Connection>[0]
  );
  const receive = (data: unknown) => socket.onmessage?.({ data });
  receive({ a: 'hs', protocol: 1, type: 'json0', id: 'scroll-regression' });
  const reply = (subscription: (typeof subscriptions)[number]) => {
    const { skip = 0, take = 64 } = subscription.q;
    receive({
      a: 'qs',
      id: subscription.id,
      data: Array.from({ length: take }, (_, index) => {
        const id = `recRow${skip + index}`;
        return { d: id, v: 1, type: 'json0', data: { id, fields: {} } };
      }),
      extra: { groupPoints: null },
    });
  };
  return { connection, subscriptions, reply };
};

describe('grid scrolling with live record subscriptions', () => {
  it('never paints previous-window records at new row numbers while scrolling down and up', async () => {
    useGridViewCacheStore.setState({ cacheMap: {} });
    const transport = createTransport();
    vi.mocked(useConnection).mockReturnValue({
      connection: transport.connection,
      connected: true,
    });
    const mismatches: Array<{ row: number; recordId: string }> = [];
    const { result, unmount } = renderHook(() => {
      const grid = useGridAsyncRecords();
      useLayoutEffect(() => {
        for (const [row, record] of Object.entries(grid.recordMap)) {
          if (record.id !== `recRow${row}`) {
            mismatches.push({ row: Number(row), recordId: record.id });
          }
        }
      }, [grid.recordMap]);
      return grid;
    });

    try {
      await waitFor(() => expect(transport.subscriptions).toHaveLength(1));
      act(() => transport.reply(transport.subscriptions[0]));
      expect(result.current.recordMap[0]?.id).toBe('recRow0');

      for (const row of [250, 450, 250, 50]) {
        const previousCount = transport.subscriptions.length;
        act(() => {
          result.current.onVisibleRegionChanged({ x: 0, y: row, width: 5, height: 30 });
        });
        await waitFor(() => expect(transport.subscriptions).toHaveLength(previousCount + 1));
        // No reply yet: missing rows may load, but existing rows must not shift.
        expect(mismatches).toEqual([]);
        act(() => transport.reply(transport.subscriptions.at(-1)!));
        expect(result.current.recordMap[row]?.id).toBe(`recRow${row}`);
        expect(mismatches).toEqual([]);
      }
    } finally {
      unmount();
      transport.connection.close();
    }
  });
});
