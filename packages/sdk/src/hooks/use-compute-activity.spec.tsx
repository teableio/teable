import { useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { ComputeActivityContext } from '../context/compute-activity/ComputeActivityContext';
import { FieldContext } from '../context/field/FieldContext';
import {
  useComputeActivity,
  useComputeActivitySubscription,
  type ComputeActivitySnapshotClient,
  type IComputeActivityState,
} from './use-compute-activity';
import { useConnection } from './use-connection';
import { useIsReadOnlyPreview } from './use-is-readonly-preview';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
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

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseConnection = vi.mocked(useConnection);
const mockedUseIsReadOnlyPreview = vi.mocked(useIsReadOnlyPreview);

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

const createDoc = (data: Record<string, unknown>) => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    data,
    subscribe: vi.fn((callback: (error?: Error) => void) => callback()),
    on: vi.fn((event: string, listener: () => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    }),
    removeAllListeners: vi.fn((event: string) => listeners.get(event)?.clear()),
    destroy: vi.fn(() => listeners.forEach((eventListeners) => eventListeners.clear())),
    emit(event: string) {
      listeners.get(event)?.forEach((listener) => listener());
    },
  };
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
  });

  it('does not create a duplicate query or ShareDB subscription when provider state exists', () => {
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
    expect(connection.get).not.toHaveBeenCalled();
    expect(field).toEqual({ id: 'fldTest', isPending: false });

    const disabledOptions = mockedUseQuery.mock.calls.at(-1)?.[0];
    const refetchInterval = disabledOptions?.refetchInterval as (query: {
      state: { data: ComputeActivitySnapshotClient };
    }) => number | false;
    expect(
      refetchInterval({
        state: {
          data: {
            ...idleSnapshot,
            fields: [{ fieldId: 'fldTest', status: 'running' }],
          },
        },
      })
    ).toBe(false);

    unmount();
    expect(connection.get).not.toHaveBeenCalled();
  });
});

describe('useComputeActivitySubscription', () => {
  beforeEach(() => {
    mockedUseQuery.mockReset();
    mockedUseConnection.mockReset();
    mockedUseIsReadOnlyPreview.mockReturnValue(false);
  });

  it('does not request or subscribe to compute activity in read-only previews', () => {
    const connection = { get: vi.fn() };
    mockedUseConnection.mockReturnValue({ connection, connected: true } as never);
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
    expect(connection.get).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.fieldMetaById).toEqual({});
  });

  it('refreshes diagnostics and polling from merged realtime and HTTP field state', async () => {
    const tableDoc = createDoc({ status: 'idle', calculatingFieldCount: 0 });
    const fieldDocs = {
      fldRunning: createDoc({
        status: 'running',
        startedAt: '2026-07-16T00:00:00.000Z',
        activeTaskCount: 3,
        processingTaskCount: 1,
        batchProgress: { total: 5, completed: 2 },
      }),
      fldQueued: createDoc({ status: 'queued' }),
      fldFailed: createDoc({ status: 'failed', lastError: 'invalid dependency' }),
    };
    const connection = {
      get: vi.fn((_collection: string, id: string) =>
        id === 'table' ? tableDoc : fieldDocs[id as keyof typeof fieldDocs]
      ),
      startBulk: vi.fn(),
      endBulk: vi.fn(),
    };
    mockedUseConnection.mockReturnValue({ connection, connected: true } as never);
    mockedUseQuery.mockReturnValue({
      data: idleSnapshot,
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldRunning' }, { id: 'fldQueued' }, { id: 'fldFailed' }]),
    });

    await waitFor(() => expect(result.current.activeFieldCount).toBe(2));
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
    const refetchInterval = latestOptions?.refetchInterval as (query: {
      state: { data: ComputeActivitySnapshotClient };
    }) => number | false;
    expect(refetchInterval({ state: { data: idleSnapshot } })).toBe(1500);
  });

  it('does not let stale realtime generations override newer HTTP activity', async () => {
    const tableDoc = createDoc({
      status: 'calculating',
      calculatingFieldCount: 1,
      generation: 3,
      updatedAt: '2026-07-18T00:00:00.000Z',
    });
    const fieldDoc = createDoc({
      status: 'queued',
      activeTaskCount: 1,
      processingTaskCount: 0,
      generation: 3,
      updatedAt: '2026-07-18T00:00:00.000Z',
      batchProgress: { total: 3, completed: 2 },
    });
    const connection = {
      get: vi.fn((_collection: string, id: string) => (id === 'table' ? tableDoc : fieldDoc)),
      startBulk: vi.fn(),
      endBulk: vi.fn(),
    };
    const httpSnapshot = {
      ...idleSnapshot,
      table: {
        ...idleSnapshot.table,
        generation: 4,
        updatedAt: '2026-07-18T00:01:00.000Z',
      },
      fields: [
        {
          fieldId: 'fldTest',
          status: 'idle',
          activeTaskCount: 0,
          processingTaskCount: 0,
          generation: 4,
          updatedAt: '2026-07-18T00:01:00.000Z',
        },
      ],
    } as ComputeActivitySnapshotClient;
    mockedUseConnection.mockReturnValue({ connection, connected: true } as never);
    mockedUseQuery.mockReturnValue({
      data: httpSnapshot,
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });

    await waitFor(() => expect(connection.get).toHaveBeenCalled());
    expect(result.current.activeFieldCount).toBe(0);
    expect(result.current.fieldMetaById.fldTest?.status).toBe('idle');
    expect(result.current.tableMeta?.status).toBe('idle');

    const latestOptions = mockedUseQuery.mock.calls.at(-1)?.[0];
    const refetchInterval = latestOptions?.refetchInterval as (query: {
      state: { data: ComputeActivitySnapshotClient };
    }) => number | false;
    expect(refetchInterval({ state: { data: httpSnapshot } })).toBe(false);
  });

  it('normalizes nullable activity timestamps before applying them to fields', async () => {
    const tableDoc = createDoc({ status: 'calculating', calculatingFieldCount: 1 });
    const fieldDoc = createDoc({
      status: 'running',
      startedAt: null,
      lastDurationMs: null,
    });
    const connection = {
      get: vi.fn((_collection: string, id: string) => (id === 'table' ? tableDoc : fieldDoc)),
      startBulk: vi.fn(),
      endBulk: vi.fn(),
    };
    const field: {
      id: string;
      computeMeta?: { startedAt?: string; lastDurationMs?: number };
    } = { id: 'fldTest' };
    mockedUseConnection.mockReturnValue({ connection, connected: true } as never);
    mockedUseQuery.mockReturnValue({
      data: idleSnapshot,
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

  it('applies newly created compute activity documents', async () => {
    const tableDoc = createDoc({});
    const fieldDoc = createDoc({});
    const connection = {
      get: vi.fn((_collection: string, id: string) => (id === 'table' ? tableDoc : fieldDoc)),
      startBulk: vi.fn(),
      endBulk: vi.fn(),
    };
    mockedUseConnection.mockReturnValue({ connection, connected: true } as never);
    mockedUseQuery.mockReturnValue({
      data: idleSnapshot,
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { result } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });
    await act(async () => {
      Object.assign(tableDoc.data, { status: 'calculating', calculatingFieldCount: 1 });
      Object.assign(fieldDoc.data, { status: 'running' });
      tableDoc.emit('create');
      fieldDoc.emit('create');
    });

    await waitFor(() => expect(result.current.activeFieldCount).toBe(1));
    expect(result.current.tableMeta?.status).toBe('calculating');
    expect(result.current.fieldMetaById.fldTest?.status).toBe('running');
  });
  it('removes only listeners owned by the hook from shared docs', async () => {
    const tableDoc = createDoc({ status: 'idle', calculatingFieldCount: 0 });
    const fieldDoc = createDoc({ status: 'queued' });
    const externalTableListener = vi.fn();
    const externalFieldListener = vi.fn();
    tableDoc.on('op', externalTableListener);
    fieldDoc.on('op', externalFieldListener);
    const connection = {
      get: vi.fn((_collection: string, id: string) => (id === 'table' ? tableDoc : fieldDoc)),
      startBulk: vi.fn(),
      endBulk: vi.fn(),
    };
    mockedUseConnection.mockReturnValue({ connection, connected: true } as never);
    mockedUseQuery.mockReturnValue({
      data: idleSnapshot,
      isFetching: false,
      refetch: vi.fn(),
    } as never);

    const { unmount } = renderHook(() => useComputeActivitySubscription(), {
      wrapper: createWrapper([{ id: 'fldTest' }]),
    });
    await act(async () => undefined);

    unmount();

    expect(tableDoc.removeListener).toHaveBeenCalledTimes(3);
    expect(fieldDoc.removeListener).toHaveBeenCalledTimes(3);
    expect(tableDoc.removeAllListeners).not.toHaveBeenCalled();
    expect(fieldDoc.removeAllListeners).not.toHaveBeenCalled();
    tableDoc.emit('op');
    fieldDoc.emit('op');
    expect(externalTableListener).toHaveBeenCalledTimes(1);
    expect(externalFieldListener).toHaveBeenCalledTimes(1);
    expect(tableDoc.destroy).not.toHaveBeenCalled();
    expect(fieldDoc.destroy).not.toHaveBeenCalled();
  });
});
