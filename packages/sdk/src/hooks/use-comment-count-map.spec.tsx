import { EventEmitter } from 'events';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { getTableCommentChannel } from '@teable/core';
import type { ICommentCountVo, ICommentPatchData } from '@teable/openapi';
import { CommentPatchType, getCommentCount, getCommentCountRoSchema } from '@teable/openapi';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { AxiosHeaders } from 'axios';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactQueryKeys } from '../config';
import { useCommentCountMap } from './use-comment-count-map';

const scope = vi.hoisted(() => ({ tableId: 'tblA', commentReadable: true }));
const presences = new Map<string, ReturnType<typeof createPresence>>();
const connection = {
  getPresence: (key: string) => {
    let presence = presences.get(key);
    if (!presence) {
      presence = createPresence();
      presences.set(key, presence);
    }
    return presence;
  },
};

function createPresence() {
  return Object.assign(new EventEmitter(), {
    remotePresences: {} as Record<string, ICommentPatchData>,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    destroy: vi.fn(),
  });
}

vi.mock(import('@teable/openapi'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCommentCount: vi.fn(),
}));
vi.mock('./use-table-id', () => ({ useTableId: () => scope.tableId }));
vi.mock('./use-comment-permission', () => ({
  useCommentPermission: () => ({ commentReadable: scope.commentReadable }),
}));
vi.mock('./use-connection', () => ({ useConnection: () => ({ connection }) }));

let queryClient: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

function receive(tableId: string, recordId: string, type: CommentPatchType) {
  const key = getTableCommentChannel(tableId);
  const presence = connection.getPresence(key);
  presence.remotePresences[key] = { type, data: { recordId } };
  act(() => {
    presence.emit('receive');
  });
}

beforeEach(() => {
  scope.tableId = 'tblA';
  scope.commentReadable = true;
  presences.clear();
  vi.mocked(getCommentCount).mockReset();
  vi.mocked(getCommentCount).mockImplementation(() => new Promise(() => {}));
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, placeholderData: keepPreviousData },
    },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('useCommentCountMap', () => {
  it('hides the previous record window and table while their replacements load', async () => {
    queryClient.setQueryData(ReactQueryKeys.commentCount('tblA', ['recA']), [
      { recordId: 'recA', count: 2 },
    ]);
    const { result, rerender } = renderHook(({ ids }) => useCommentCountMap(ids), {
      initialProps: { ids: ['recA'] },
      wrapper,
    });
    expect(result.current).toEqual({ recA: 2 });

    rerender({ ids: ['recB'] });
    expect(result.current).toEqual({});
    receive('tblA', 'recA', CommentPatchType.CreateComment);
    expect(result.current).toEqual({});

    act(() => {
      queryClient.setQueryData(ReactQueryKeys.commentCount('tblA', ['recB']), [
        { recordId: 'recB', count: 3 },
      ]);
    });
    await waitFor(() => expect(result.current).toEqual({ recB: 3 }));

    scope.tableId = 'tblB';
    rerender({ ids: ['recB'] });
    expect(result.current).toEqual({});
    receive('tblA', 'recB', CommentPatchType.CreateComment);
    expect(result.current).toEqual({});
  });

  it('keeps the presence subscription while the loaded window changes identity', async () => {
    const ids = ['recA', 'recB'];
    queryClient.setQueryData(ReactQueryKeys.commentCount('tblA', ids), [
      { recordId: 'recA', count: 1 },
    ]);
    const { result, rerender } = renderHook(({ ids }) => useCommentCountMap(ids), {
      initialProps: { ids },
      wrapper,
    });
    const presence = connection.getPresence(getTableCommentChannel('tblA'));
    expect(presence.subscribe).toHaveBeenCalledTimes(1);

    // Every record delivery hands over a new array with the same ids.
    rerender({ ids: [...ids] });
    rerender({ ids: [...ids] });
    expect(presence.subscribe).toHaveBeenCalledTimes(1);
    expect(presence.unsubscribe).not.toHaveBeenCalled();
    expect(presence.destroy).not.toHaveBeenCalled();

    // A scrolled window still routes live events against the current ids.
    rerender({ ids: ['recB', 'recC'] });
    expect(presence.subscribe).toHaveBeenCalledTimes(1);
    act(() => {
      queryClient.setQueryData(ReactQueryKeys.commentCount('tblA', ['recB', 'recC']), [
        { recordId: 'recC', count: 1 },
      ]);
    });
    await waitFor(() => expect(result.current).toEqual({ recC: 1 }));
    receive('tblA', 'recA', CommentPatchType.CreateComment);
    expect(result.current).toEqual({ recC: 1 });
    receive('tblA', 'recB', CommentPatchType.CreateComment);
    await waitFor(() => expect(result.current).toEqual({ recB: 1, recC: 1 }));

    scope.tableId = 'tblB';
    rerender({ ids: ['recB', 'recC'] });
    expect(presence.unsubscribe).toHaveBeenCalledTimes(1);
    expect(presence.destroy).toHaveBeenCalledTimes(1);
  });

  it('hides cached counts and avoids requests for disabled or empty scopes', () => {
    queryClient.setQueryData(ReactQueryKeys.commentCount('tblA', ['recA']), [
      { recordId: 'recA', count: 2 },
    ]);
    const { result, rerender } = renderHook(({ ids }) => useCommentCountMap(ids), {
      initialProps: { ids: ['recA'] },
      wrapper,
    });
    expect(result.current).toEqual({ recA: 2 });

    scope.commentReadable = false;
    rerender({ ids: ['recA'] });
    expect(result.current).toEqual({});
    receive('tblA', 'recA', CommentPatchType.CreateComment);
    expect(result.current).toEqual({});

    rerender({ ids: ['recUncached'] });
    expect(result.current).toEqual({});
    scope.commentReadable = true;
    rerender({ ids: [] });
    expect(result.current).toEqual({});
    expect(getCommentCount).not.toHaveBeenCalled();
  });

  it('retains counts across all batches when the loaded window exceeds 1000 records', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => `rec${index}`);
    const counts: ICommentCountVo = [
      { recordId: ids[0], count: 2 },
      { recordId: ids[1000], count: 3 },
    ];
    vi.mocked(getCommentCount).mockImplementation(async (_tableId, body) => {
      const { recordIds } = getCommentCountRoSchema.parse(body);
      return {
        data: counts.filter(({ recordId }) => recordIds.includes(recordId)),
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: new AxiosHeaders() },
      };
    });
    const { result } = renderHook(() => useCommentCountMap(ids), { wrapper });

    await waitFor(() => expect(result.current).toEqual({ rec0: 2, rec1000: 3 }));
    const requestedIds = vi
      .mocked(getCommentCount)
      .mock.calls.flatMap(([, body]) => body.recordIds);
    expect(requestedIds).toEqual(ids);

    receive('tblA', ids[1000], CommentPatchType.CreateComment);
    await waitFor(() => expect(result.current).toEqual({ rec0: 2, rec1000: 4 }));
  });

  it('applies live creates and deletes only within the loaded window without mutating snapshots', async () => {
    const snapshot: ICommentCountVo = [{ recordId: 'recA', count: 1 }];
    Object.freeze(snapshot[0]);
    Object.freeze(snapshot);
    const ids = ['recA', 'recB'];
    queryClient.setQueryData(ReactQueryKeys.commentCount('tblA', ids), snapshot);
    const { result } = renderHook(() => useCommentCountMap(ids), { wrapper });
    expect(result.current).toEqual({ recA: 1 });

    receive('tblA', 'recOutside', CommentPatchType.CreateComment);
    receive('tblA', 'recA', CommentPatchType.UpdateComment);
    expect(result.current).toEqual({ recA: 1 });

    receive('tblA', 'recA', CommentPatchType.CreateComment);
    receive('tblA', 'recB', CommentPatchType.CreateComment);
    await waitFor(() => expect(result.current).toEqual({ recA: 2, recB: 1 }));
    expect(snapshot).toEqual([{ recordId: 'recA', count: 1 }]);

    receive('tblA', 'recA', CommentPatchType.DeleteComment);
    receive('tblA', 'recB', CommentPatchType.DeleteComment);
    receive('tblA', 'recB', CommentPatchType.DeleteComment);
    await waitFor(() => expect(result.current).toEqual({ recA: 1 }));
    receive('tblA', 'recA', CommentPatchType.DeleteComment);
    await waitFor(() => expect(result.current).toEqual({}));
  });
});
