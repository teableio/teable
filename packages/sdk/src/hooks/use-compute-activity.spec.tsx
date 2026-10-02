import type { QueryClient } from '@tanstack/react-query';
import type * as ReactQuery from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { sonner } from '@teable/ui-lib';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { createQueryClient } from '../context/app/queryClient';
import { ComputeActivityContext } from '../context/compute-activity/ComputeActivityContext';
import { FieldContext } from '../context/field/FieldContext';
import {
  COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS,
  useComputeActivity,
  useComputeActivitySubscription,
  type ComputeActivitySnapshotClient,
  type IComputeActivityState,
} from './use-compute-activity';
import { useConnection } from './use-connection';
import { useIsReadOnlyPreview } from './use-is-readonly-preview';
import { useTableId } from './use-table-id';
import { useTableListener } from './use-table-listener';

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactQuery>()),
  useQuery: vi.fn(),
}));

vi.mock('@teable/ui-lib', () => ({
  sonner: { toast: { error: vi.fn(), warning: vi.fn() } },
}));

vi.mock('../components/billing/store/usage-limit-modal', () => ({
  openUsageLimitModalFromError: vi.fn(() => false),
}));

vi.mock('./use-base-id', () => ({
  useBaseId: vi.fn(() => 'bseTest'),
}));

vi.mock('./use-table-id', () => ({
  useTableId: vi.fn(() => 'tblTest'),
}));

vi.mock('./use-connection', () => ({
  useConnection: vi.fn(),
}));

vi.mock('./use-is-readonly-preview', () => ({
  useIsReadOnlyPreview: vi.fn(() => false),
}));

vi.mock('./use-table-listener', () => ({
  useTableListener: vi.fn(),
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseConnection = vi.mocked(useConnection);
const mockedUseIsReadOnlyPreview = vi.mocked(useIsReadOnlyPreview);
const mockedUseTableListener = vi.mocked(useTableListener);
const mockedUseTableId = vi.mocked(useTableId);

const idleSnapshot: ComputeActivitySnapshotClient = {
  tableId: 'tblTest',
  baseId: 'bseTest',
  table: {
    status: 'idle',
    calculatingFieldCount: 0,
    queuedFieldCount: 0,
  },
  fields: [{ fieldId: 'fldTest', status: 'idle' }],
  diagnostics: {
    computeMode: 'server',
    activeFieldCount: 0,
    queuedFieldCount: 0,
    calculatingFieldCount: 0,
    failedFieldCount: 0,
    highComplexityFieldCount: 0,
    anomalies: [
      {
        fieldId: 'fldTest',
        kind: 'slow',
        message: 'The last calculation was slow',
      },
    ],
  },
};

const emitComputeActivityChanged = () => {
  const callback = mockedUseTableListener.mock.calls.at(-1)?.[2];
  if (!callback) {
    throw new Error('compute activity listener is not registered');
  }
  callback('computeActivityChanged');
};

const snapshotPayload = (
  fields: ComputeActivitySnapshotClient['fields'] = []
): ComputeActivitySnapshotClient => ({
  ...idleSnapshot,
  table: null,
  fields,
});

const activityResponse = (
  fields: ComputeActivitySnapshotClient['fields'] = [],
  init?: ResponseInit
) => new Response(JSON.stringify({ ok: true, data: snapshotPayload(fields) }), init);

const createDeferredFetch = () => {
  const pending: Array<(value: Response) => void> = [];
  const fetchStatus = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
  return {
    fetchStatus,
    resolveNext: (fields: ComputeActivitySnapshotClient['fields'] = []) => {
      const resolve = pending.shift();
      if (!resolve) throw new Error('no pending fetch');
      resolve(activityResponse(fields));
    },
    failNext: (status = 503) => {
      const resolve = pending.shift();
      if (!resolve) throw new Error('no pending fetch');
      resolve(new Response(JSON.stringify({ ok: false }), { status }));
    },
    pendingCount: () => pending.length,
  };
};

const mountLive = async ({
  fetch,
  connected = true,
  fields = [{ id: 'fldTest' }],
  client,
}: {
  fetch: typeof globalThis.fetch;
  connected?: boolean;
  fields?: Array<{ id: string; canReadFieldRecord?: boolean }>;
  client?: QueryClient;
}) => {
  const queryModule = await vi.importActual<typeof ReactQuery>('@tanstack/react-query');
  const queryClient = client ?? createQueryClient();
  mockedUseQuery.mockImplementation(queryModule.useQuery);
  mockedUseConnection.mockReturnValue({ connected } as never);
  vi.stubGlobal('fetch', fetch);
  const hook = renderHook(() => useComputeActivitySubscription(), {
    wrapper: ({ children }) => (
      <queryModule.QueryClientProvider client={queryClient}>
        <FieldContext.Provider value={{ fields: fields as never[] }}>
          {children}
        </FieldContext.Provider>
      </queryModule.QueryClientProvider>
    ),
  });
  return { ...hook, client: queryClient };
};

const flushQuery = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  if (vi.isFakeTimers()) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
};

const createWrapper = (
  fields: Array<{ id: string; canReadFieldRecord?: boolean }>,
  shared: IComputeActivityState | null = null
) => {
  function computeActivityTestWrapper({ children }: { children: ReactNode }) {
    return (
      <ComputeActivityContext.Provider value={shared}>
        <FieldContext.Provider value={{ fields: fields as never[] }}>
          {children}
        </FieldContext.Provider>
      </ComputeActivityContext.Provider>
    );
  }
  return computeActivityTestWrapper;
};

const sharedActivity: IComputeActivityState = {
  snapshot: null,
  tableMeta: null,
  fieldMetaById: {},
  diagnostics: null,
  activeFieldCount: 0,
  isFetching: false,
  refetch: vi.fn(),
  revision: 0,
};

describe('useComputeActivity', () => {
  beforeEach(() => {
    mockedUseQuery.mockReset();
    mockedUseConnection.mockReset();
    mockedUseTableListener.mockReset();
  });

  it('does not create a duplicate query or presence subscription when provider state exists', () => {
    const connection = { get: vi.fn() };
    const field = { id: 'fldTest', isPending: false };
    mockedUseConnection.mockReturnValue({ connection, connected: true } as never);
    mockedUseQuery.mockReturnValue({
      data: idleSnapshot,
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result, unmount } = renderHook(() => useComputeActivity(), {
      wrapper: createWrapper([field], sharedActivity),
    });

    expect(result.current).toBe(sharedActivity);
    expect(mockedUseQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(mockedUseTableListener.mock.calls.every(([id]) => id === undefined)).toBe(true);
    expect(field).toEqual({ id: 'fldTest', isPending: false });

    const disabledOptions = mockedUseQuery.mock.calls.at(-1)?.[0];
    expect(disabledOptions?.refetchInterval).toBeUndefined();

    unmount();
    expect(mockedUseTableListener.mock.calls.every(([id]) => id === undefined)).toBe(true);
  });
});

describe('useComputeActivitySubscription', () => {
  beforeEach(() => {
    mockedUseQuery.mockReset();
    mockedUseConnection.mockReset();
    mockedUseTableListener.mockReset();
    mockedUseIsReadOnlyPreview.mockReturnValue(false);
  });

  it('distinguishes initial loading from server reconciliation for an empty table', () => {
    mockedUseConnection.mockReturnValue({
      connection: { get: vi.fn(), state: 'connecting' },
      connected: false,
    } as never);
    const refetch = vi.fn();
    mockedUseQuery.mockReturnValue({ data: undefined, isFetching: true, refetch } as never);
    const { result, rerender } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldText' }]),
    });

    expect(result.current.observationState).toBe('loading');

    mockedUseQuery.mockReturnValue({
      data: { ...idleSnapshot, table: null, fields: [] },
      isFetching: false,
      refetch,
    } as never);
    rerender();
    expect(result.current.observationState).toBe('available');
    expect(result.current.activeFieldCount).toBe(0);
  });

  it('retains the last snapshot when the realtime connection is disconnected', () => {
    mockedUseConnection.mockReturnValue({
      connection: { get: vi.fn(), state: 'disconnected' },
      connected: false,
    } as never);
    mockedUseQuery.mockReturnValue({
      data: idleSnapshot,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });
    expect(result.current.observationState).toBe('unavailable');
    expect(result.current.snapshot).toBe(idleSnapshot);
  });

  it('does not issue a second getComputeActivity on the initial ShareDB connect', async () => {
    const queryModule = await vi.importActual<typeof ReactQuery>('@tanstack/react-query');
    const client = createQueryClient();
    mockedUseQuery.mockImplementation(queryModule.useQuery);
    mockedUseConnection.mockReturnValue({ connected: false } as never);
    const fetchStatus = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, data: { ...idleSnapshot, table: null, fields: [] } })
        )
      )
    );
    vi.stubGlobal('fetch', fetchStatus);
    const { rerender, unmount } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: ({ children }) => (
        <queryModule.QueryClientProvider client={client}>
          <FieldContext.Provider value={{ fields: [{ id: 'fldText' }] as never[] }}>
            {children}
          </FieldContext.Provider>
        </queryModule.QueryClientProvider>
      ),
    });
    try {
      await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
      expect(String(fetchStatus.mock.calls[0]?.[0])).toContain('/api/v2/tables/getComputeActivity');
      mockedUseConnection.mockReturnValue({ connected: true } as never);
      rerender();
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      client.clear();
      vi.unstubAllGlobals();
    }
  });

  it('issues another getComputeActivity after a ShareDB reconnect', async () => {
    const queryModule = await vi.importActual<typeof ReactQuery>('@tanstack/react-query');
    const client = createQueryClient();
    mockedUseQuery.mockImplementation(queryModule.useQuery);
    mockedUseConnection.mockReturnValue({ connected: true } as never);
    const fetchStatus = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, data: { ...idleSnapshot, table: null, fields: [] } })
        )
      )
    );
    vi.stubGlobal('fetch', fetchStatus);
    const { rerender, unmount } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: ({ children }) => (
        <queryModule.QueryClientProvider client={client}>
          <FieldContext.Provider value={{ fields: [{ id: 'fldTest' }] as never[] }}>
            {children}
          </FieldContext.Provider>
        </queryModule.QueryClientProvider>
      ),
    });
    try {
      await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
      mockedUseConnection.mockReturnValue({ connected: false } as never);
      rerender();
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      mockedUseConnection.mockReturnValue({ connected: true } as never);
      rerender();
      await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(2), { timeout: 3000 });
      expect(String(fetchStatus.mock.calls[1]?.[0])).toContain('/api/v2/tables/getComputeActivity');
    } finally {
      unmount();
      client.clear();
      vi.unstubAllGlobals();
    }
  });

  it('reports a failed initial read instead of remaining in loading', () => {
    mockedUseConnection.mockReturnValue({ connected: false } as never);
    mockedUseQuery.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldText' }]),
    });
    expect(result.current.observationState).toBe('unavailable');
  });

  it('ends a stalled initial request and recovers when the status is refreshed', async () => {
    const queryModule = await vi.importActual<typeof ReactQuery>('@tanstack/react-query');
    const client = createQueryClient();
    vi.mocked(sonner.toast.error).mockClear();
    mockedUseQuery.mockImplementation(queryModule.useQuery);
    mockedUseConnection.mockReturnValue({ connected: false } as never);
    vi.useFakeTimers();
    const fetchStatus = vi.fn<typeof fetch>((_input, init) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError'))
      );
      return promise;
    });
    vi.stubGlobal('fetch', fetchStatus);
    const { result, unmount } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: ({ children }) => (
        <queryModule.QueryClientProvider client={client}>
          <FieldContext.Provider value={{ fields: [{ id: 'fldText' }] as never[] }}>
            {children}
          </FieldContext.Provider>
        </queryModule.QueryClientProvider>
      ),
    });
    try {
      expect(result.current.observationState).toBe('loading');
      await act(() => vi.advanceTimersByTimeAsync(15_001));
      expect(result.current.observationState).toBe('unavailable');
      expect(sonner.toast.error).not.toHaveBeenCalled();

      fetchStatus.mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, data: { ...idleSnapshot, table: null, fields: [] } })
        )
      );
      await act(async () => {
        await result.current.refetch();
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.observationState).toBe('available');
      expect(result.current.activeFieldCount).toBe(0);
    } finally {
      unmount();
      client.clear();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it.each([403, 503, 200])('keeps failed HTTP status reads local (%s)', async (status) => {
    const queryModule = await vi.importActual<typeof ReactQuery>('@tanstack/react-query');
    const client = createQueryClient();
    vi.mocked(sonner.toast.error).mockClear();
    mockedUseQuery.mockImplementation(queryModule.useQuery);
    mockedUseConnection.mockReturnValue({ connected: false } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status }))
    );
    const { result, unmount } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: ({ children }) => (
        <queryModule.QueryClientProvider client={client}>
          <FieldContext.Provider value={{ fields: [] }}>{children}</FieldContext.Provider>
        </queryModule.QueryClientProvider>
      ),
    });
    try {
      await waitFor(() => expect(result.current.observationState).toBe('unavailable'));
      expect(sonner.toast.error).not.toHaveBeenCalled();
      expect(result.current.snapshot).toBeNull();
    } finally {
      unmount();
      client.clear();
      vi.unstubAllGlobals();
    }
  });

  it('retains a successful snapshot and exposes an unavailable observation after a failed refresh', () => {
    mockedUseConnection.mockReturnValue({ connected: false } as never);
    mockedUseQuery.mockReturnValue({
      data: idleSnapshot,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });
    expect(result.current.snapshot).toBe(idleSnapshot);
    expect(result.current.observationState).toBe('unavailable');
    expect(result.current.fieldMetaById.fldTest.status).toBe('idle');
  });

  it('does not request or subscribe to compute activity in read-only previews', () => {
    mockedUseConnection.mockReturnValue({ connection: undefined, connected: true } as never);
    mockedUseIsReadOnlyPreview.mockReturnValue(true);
    mockedUseQuery.mockReturnValue({
      data: idleSnapshot,
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });

    expect(mockedUseQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(mockedUseTableListener.mock.calls.at(-1)?.[0]).toBeUndefined();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.fieldMetaById).toEqual({});
  });

  it('loads field diagnostics from HTTP and listens on the table presence channel', async () => {
    mockedUseConnection.mockReturnValue({ connected: true } as never);
    mockedUseQuery.mockReturnValue({
      data: {
        ...idleSnapshot,
        fields: [
          {
            fieldId: 'fldRunning',
            status: 'running',
            startedAt: '2026-07-16T00:00:00.000Z',
            activeTaskCount: 3,
            processingTaskCount: 1,
            batchProgress: { total: 5, completed: 2 },
          },
          { fieldId: 'fldQueued', status: 'queued' },
          { fieldId: 'fldFailed', status: 'failed', lastError: 'invalid dependency' },
        ],
      },
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldRunning' }, { id: 'fldQueued' }, { id: 'fldFailed' }]),
    });

    await waitFor(() => expect(result.current.activeFieldCount).toBe(2));
    expect(mockedUseTableListener).toHaveBeenCalledWith(
      'tblTest',
      ['computeActivityChanged'],
      expect.any(Function)
    );
    expect(result.current.diagnostics).toMatchObject({
      activeFieldCount: 2,
      queuedFieldCount: 1,
      calculatingFieldCount: 1,
      failedFieldCount: 1,
      anomalies: idleSnapshot.diagnostics.anomalies,
    });
    expect(result.current.fieldMetaById.fldRunning).toMatchObject({
      activeTaskCount: 3,
      processingTaskCount: 1,
      batchProgress: { total: 5, completed: 2 },
    });

    const latestOptions = mockedUseQuery.mock.calls.at(-1)?.[0];
    expect(latestOptions?.refetchInterval).toBeUndefined();
  });

  it('surfaces execution state and pause blockers from the HTTP diagnostics', async () => {
    const pause = {
      effective: true,
      blockers: [
        {
          id: 'cup_lease',
          scopeType: 'base' as const,
          scopeId: 'bseTest',
          pausedAt: '2026-07-16T00:00:00.000Z',
          pausedBy: 'ops',
          resumeAt: '2026-07-16T00:30:00.000Z',
          reason: 'index build window',
        },
      ],
      queuedTaskCount: 12,
      oldestQueuedAt: '2026-07-16T00:00:00.000Z',
    };
    mockedUseConnection.mockReturnValue({ connection: undefined, connected: false } as never);
    mockedUseQuery.mockReturnValue({
      data: {
        ...idleSnapshot,
        diagnostics: { ...idleSnapshot.diagnostics, executionState: 'paused' as const, pause },
      },
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });

    await waitFor(() => expect(result.current.diagnostics?.executionState).toBe('paused'));
    expect(result.current.diagnostics?.pause).toEqual(pause);
  });

  describe('refresh scheduler', () => {
    const unresolvedField = {
      fieldId: 'fldTest',
      status: 'idle' as const,
      reliability: {
        unresolvedCount: 1,
        oldestUnresolvedAt: null,
        scopeComplete: true,
      },
    };

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('merges notices that arrive while a refresh timer is waiting', async () => {
      vi.useFakeTimers();
      const fetchStatus = vi.fn(() => Promise.resolve(activityResponse()));
      const { unmount } = await mountLive({ fetch: fetchStatus });
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        emitComputeActivityChanged();
        emitComputeActivityChanged();
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      unmount();
    });

    it('does not trail when no notice arrives during a request', async () => {
      vi.useFakeTimers();
      const deferred = createDeferredFetch();
      const { unmount } = await mountLive({ fetch: deferred.fetchStatus });
      expect(deferred.pendingCount()).toBe(1);
      await act(async () => {
        deferred.resolveNext();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('trails once after notices during a request and then stops', async () => {
      vi.useFakeTimers();
      const deferred = createDeferredFetch();
      const { unmount } = await mountLive({ fetch: deferred.fetchStatus });
      await act(async () => {
        emitComputeActivityChanged();
        emitComputeActivityChanged();
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'running' }]);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        deferred.resolveNext();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(2);
      unmount();
    });

    it('recovers idle from a notice during the first request without waiting for poll', async () => {
      vi.useFakeTimers();
      const deferred = createDeferredFetch();
      const { result, unmount } = await mountLive({ fetch: deferred.fetchStatus });
      await act(async () => {
        emitComputeActivityChanged();
      });
      await act(async () => {
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'running' }]);
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      await act(async () => {
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'idle' }]);
      });
      await flushQuery();
      expect(result.current.activeFieldCount).toBe(0);
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(2);
      unmount();
    });

    it('does not start a concurrent request while one is in flight past the min interval', async () => {
      vi.useFakeTimers();
      const deferred = createDeferredFetch();
      const { unmount } = await mountLive({ fetch: deferred.fetchStatus });
      await act(async () => {
        emitComputeActivityChanged();
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS + 200);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('does not insert a fallback poll after successful presence refreshes', async () => {
      vi.useFakeTimers();
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const fetchStatus = vi.fn(() =>
        Promise.resolve(activityResponse([{ fieldId: 'fldTest', status: 'running' }]))
      );
      const { unmount } = await mountLive({ fetch: fetchStatus });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
        emitComputeActivityChanged();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_000);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      unmount();
      random.mockRestore();
    });

    it('falls back at the active interval when notices stop', async () => {
      vi.useFakeTimers();
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const fetchStatus = vi.fn(() => Promise.resolve(activityResponse([unresolvedField])));
      const { result, unmount } = await mountLive({ fetch: fetchStatus });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      expect(result.current.fieldMetaById.fldTest?.reliability?.unresolvedCount).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      unmount();
      random.mockRestore();
    });

    it('keeps the active poll while only table-level reliability is unresolved', async () => {
      vi.useFakeTimers();
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const payload: ComputeActivitySnapshotClient = {
        ...snapshotPayload([]),
        diagnostics: {
          ...idleSnapshot.diagnostics,
          reliability: {
            unresolvedCount: 1,
            oldestUnresolvedAt: null,
            scopeComplete: false,
          },
        },
      };
      const fetchStatus = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true, data: payload })))
      );
      const { result, unmount } = await mountLive({ fetch: fetchStatus });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      expect(result.current.diagnostics?.reliability?.unresolvedCount).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
        emitComputeActivityChanged();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(3);
      unmount();
      random.mockRestore();
    });

    it('does not issue event-driven HTTP while hidden and catch-up on visible', async () => {
      vi.useFakeTimers();
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const fetchStatus = vi.fn(() => Promise.resolve(activityResponse([unresolvedField])));
      const { unmount } = await mountLive({ fetch: fetchStatus });
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchStatus).toHaveBeenCalledTimes(1);

      visibility.mockReturnValue('hidden');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        emitComputeActivityChanged();
        emitComputeActivityChanged();
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(1);

      visibility.mockReturnValue('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      unmount();
      visibility.mockRestore();
    });

    it('does not retry-storm after a failed read', async () => {
      vi.useFakeTimers();
      const fetchStatus = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 503 }))
      );
      const { unmount } = await mountLive({ fetch: fetchStatus });
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('does not spin fallback timers while a due poll request is in flight', async () => {
      vi.useFakeTimers();
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const deferred = createDeferredFetch();
      const { unmount } = await mountLive({ fetch: deferred.fetchStatus });
      await act(async () => {
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'running' }]);
      });
      await flushQuery();
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(2);
      unmount();
      random.mockRestore();
    });

    it('trails after a first request longer than the min interval', async () => {
      vi.useFakeTimers();
      const deferred = createDeferredFetch();
      const { result, unmount } = await mountLive({ fetch: deferred.fetchStatus });
      await act(async () => {
        emitComputeActivityChanged();
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'running' }]);
      });
      await flushQuery();
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'idle' }]);
      });
      await flushQuery();
      expect(result.current.activeFieldCount).toBe(0);
      unmount();
    });

    it('falls back after an initial failed read without presence', async () => {
      vi.useFakeTimers();
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const fetchStatus = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 503 }))
      );
      const { result, unmount } = await mountLive({ fetch: fetchStatus });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      expect(result.current.observationState).toBe('unavailable');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
      unmount();
      random.mockRestore();
    });

    it('does not retry every second after fallback failures', async () => {
      vi.useFakeTimers();
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      let calls = 0;
      const fetchStatus = vi.fn(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(activityResponse([{ fieldId: 'fldTest', status: 'running' }]));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 503 }));
      });
      const { unmount } = await mountLive({ fetch: fetchStatus });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      unmount();
      random.mockRestore();
    });

    it('restores fallback poll after remounting onto a cached snapshot', async () => {
      vi.useFakeTimers();
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const fetchStatus = vi.fn(() =>
        Promise.resolve(activityResponse([{ fieldId: 'fldTest', status: 'running' }]))
      );
      const first = await mountLive({ fetch: fetchStatus });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      first.unmount();
      const second = await mountLive({ fetch: fetchStatus, client: first.client });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      expect(second.result.current.activeFieldCount).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      second.unmount();
      first.client.clear();
      random.mockRestore();
    });

    it('trails a fast background refetch that never paints isFetching', async () => {
      vi.useFakeTimers();
      const fetchStatus = vi.fn(() =>
        Promise.resolve(activityResponse([{ fieldId: 'fldTest', status: 'running' }]))
      );
      const { unmount } = await mountLive({ fetch: fetchStatus });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
        emitComputeActivityChanged();
        emitComputeActivityChanged();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(3);
      unmount();
    });

    it('trails the new table after a switch while both requests fetch', async () => {
      vi.useFakeTimers();
      const deferred = createDeferredFetch();
      mockedUseTableId.mockReturnValue('tblA');
      const { rerender, unmount } = await mountLive({ fetch: deferred.fetchStatus });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(1);
      mockedUseTableId.mockReturnValue('tblB');
      rerender();
      await act(async () => {
        await Promise.resolve();
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(2);
      await act(async () => {
        emitComputeActivityChanged();
      });
      await act(async () => {
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'running' }]);
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'running' }]);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(3);
      unmount();
      mockedUseTableId.mockReturnValue('tblTest');
    });

    it('keeps the min interval after remounting onto a cached snapshot', async () => {
      vi.useFakeTimers();
      const fetchStatus = vi.fn(() =>
        Promise.resolve(activityResponse([{ fieldId: 'fldTest', status: 'running' }]))
      );
      const first = await mountLive({ fetch: fetchStatus });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      first.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const second = await mountLive({ fetch: fetchStatus, client: first.client });
      await flushQuery();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        emitComputeActivityChanged();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS - 100);
      });
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      second.unmount();
      first.client.clear();
    });

    it('does not let an old table request schedule the new table', async () => {
      vi.useFakeTimers();
      const deferred = createDeferredFetch();
      mockedUseTableId.mockReturnValue('tblA');
      const { rerender, unmount } = await mountLive({ fetch: deferred.fetchStatus });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(1);
      await act(async () => {
        emitComputeActivityChanged();
      });
      mockedUseTableId.mockReturnValue('tblB');
      rerender();
      await act(async () => {
        await Promise.resolve();
      });
      const callsAfterSwitch = deferred.fetchStatus.mock.calls.length;
      await act(async () => {
        deferred.resolveNext([{ fieldId: 'fldTest', status: 'running' }]);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(deferred.fetchStatus.mock.calls.length).toBe(callsAfterSwitch);
      unmount();
      mockedUseTableId.mockReturnValue('tblTest');
    });

    it('drops trailing work when the hook unmounts', async () => {
      vi.useFakeTimers();
      const deferred = createDeferredFetch();
      const { unmount } = await mountLive({ fetch: deferred.fetchStatus });
      await act(async () => {
        emitComputeActivityChanged();
      });
      unmount();
      await act(async () => {
        deferred.resolveNext();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS);
      });
      expect(deferred.fetchStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('preserves a server syncing observation even when HTTP succeeds', () => {
    mockedUseConnection.mockReturnValue({ connected: false } as never);
    mockedUseQuery.mockReturnValue({
      data: { ...idleSnapshot, observationState: 'syncing' },
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });
    expect(result.current.observationState).toBe('syncing');
  });

  it('keeps HTTP field failures while the table summary is idle', () => {
    mockedUseConnection.mockReturnValue({ connected: true } as never);
    mockedUseQuery.mockReturnValue({
      data: {
        ...idleSnapshot,
        fields: [
          {
            fieldId: 'fldTest',
            status: 'failed',
            generation: 0,
            reliability: {
              unresolvedCount: 1,
              oldestUnresolvedAt: null,
              scopeComplete: true,
            },
          },
        ],
      },
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });
    expect(result.current.fieldMetaById.fldTest.reliability?.unresolvedCount).toBe(1);
    expect(result.current.fieldMetaById.fldTest.status).toBe('failed');
  });

  it('normalizes nullable activity timestamps from HTTP before applying them to fields', async () => {
    const field: {
      id: string;
      computeMeta?: { startedAt?: string; lastDurationMs?: number };
    } = { id: 'fldTest' };
    mockedUseConnection.mockReturnValue({ connected: false } as never);
    mockedUseQuery.mockReturnValue({
      data: {
        ...idleSnapshot,
        fields: [{ fieldId: 'fldTest', status: 'running' }],
      },
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([field]),
    });

    await waitFor(() => expect(result.current.activeFieldCount).toBe(1));
    expect(result.current.fieldMetaById.fldTest?.startedAt).toBeUndefined();
    expect(result.current.fieldMetaById.fldTest?.lastDurationMs).toBeUndefined();
    expect(field.computeMeta?.startedAt).toBeUndefined();
    expect(field.computeMeta?.lastDurationMs).toBeUndefined();
  });

  it('keeps activity inside the current table and readable field set', async () => {
    mockedUseConnection.mockReturnValue({ connection: null, connected: false } as never);
    mockedUseQuery.mockReturnValue({
      data: {
        ...idleSnapshot,
        fields: [
          { fieldId: 'fldVisible', tableId: 'tblTest', status: 'running' },
          { fieldId: 'fldDenied', tableId: 'tblTest', status: 'running' },
          { fieldId: 'fldOtherTable', tableId: 'tblOther', status: 'running' },
        ],
      },
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([
        { id: 'fldVisible', canReadFieldRecord: true },
        { id: 'fldDenied', canReadFieldRecord: false },
        { id: 'fldOtherTable', canReadFieldRecord: true },
      ]),
    });

    await waitFor(() => expect(result.current.activeFieldCount).toBe(1));
    expect(Object.keys(result.current.fieldMetaById)).toEqual(['fldVisible']);
  });
});
