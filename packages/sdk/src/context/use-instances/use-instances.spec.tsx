/* eslint-disable @typescript-eslint/no-explicit-any */
import { FieldKeyType, HttpError } from '@teable/core';
import type { IRecord } from '@teable/core';
import { axios, getRecords } from '@teable/openapi';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Connection, type Doc, type Query } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { Record as RecordInstance } from '../../model/record/record';
import { createAppContext } from '../__tests__/createAppContext';
import { createConnectionContext } from '../__tests__/createConnectionContext';
import { createSessionContext } from '../__tests__/createSessionContext';
import type { IAppContext } from '../app';
import { ShareViewContext } from '../table/ShareViewContext';
import type { IUseInstancesProps } from './useInstances';
import { useInstances } from './useInstances';

vi.mock('@teable/openapi', async () => {
  const actual = await vi.importActual('@teable/openapi');
  return {
    ...actual,
    getRecords: vi.fn(),
  };
});

const createUseInstancesWrap = (
  appContext: Partial<IAppContext & { connected: boolean; connection: Connection }>
) => {
  const AppProvider = createAppContext(appContext);
  const ConnectionProvider = createConnectionContext({
    connected: appContext.connected ?? false,
    connection: appContext.connection,
  });
  const SessionProvider = createSessionContext();

  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <AppProvider>
      <ConnectionProvider>
        <SessionProvider>{children}</SessionProvider>
      </ConnectionProvider>
    </AppProvider>
  );
};

describe('useInstances hook', () => {
  const mockQueryMethods = {
    on: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    removeListener: vi.fn(),
    destroy: vi.fn((cb?: () => void) => cb?.()),
  };

  const createMockDoc = (arg: Record<string, any>) =>
    ({
      ...arg,
      on: vi.fn(),
      destroy: vi.fn(),
      listenerCount: vi.fn(),
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }) as any;

  const createTrackedDoc = (
    arg: Record<string, any>,
    options?: {
      emitInvokesHandlers?: boolean;
    }
  ) => {
    const state = {
      opBatchListeners: 0,
      opBatchHandlers: [] as Array<(op: unknown[]) => void>,
      emittedOpBatches: [] as unknown[][],
      destroyed: false,
    };
    const emitInvokesHandlers = options?.emitInvokesHandlers ?? true;

    const doc = {
      ...arg,
      emit: vi.fn((event: string, ops: unknown[]) => {
        if (event === 'op batch') {
          state.emittedOpBatches.push(ops);
          if (emitInvokesHandlers) {
            state.opBatchHandlers.forEach((handler) => handler(ops));
          }
        }
      }),
      on: vi.fn((event: string, handler?: (op: unknown[]) => void) => {
        if (event === 'op batch' && handler) {
          state.opBatchListeners += 1;
          state.opBatchHandlers.push(handler);
        }
      }),
      destroy: vi.fn(() => {
        state.destroyed = true;
      }),
      listenerCount: vi.fn((event?: string) => {
        if (event === 'op batch') {
          return state.opBatchListeners;
        }
        return 0;
      }),
      removeEventListener: vi.fn(),
      removeListener: vi.fn((event: string, handler?: (op: unknown[]) => void) => {
        if (event === 'op batch' && handler) {
          state.opBatchHandlers = state.opBatchHandlers.filter((cb) => cb !== handler);
          state.opBatchListeners = state.opBatchHandlers.length;
        }
      }),
    } as any;

    return { doc, state };
  };

  // Factory function for creating test data instances
  const createTestInstance = vi.fn((data: any, doc?: any) => {
    return { ...data, doc };
  });

  const mockProps: IUseInstancesProps<any, any> = {
    collection: 'testCollection',
    factory: createTestInstance,
    queryParams: {},
  };

  const createMockPresence = () => {
    let receiveListener: ((id: string, batch: unknown) => void) | undefined;
    return {
      presence: {
        subscribed: false,
        subscribe: vi.fn((cb?: (error?: unknown) => void) => cb?.()),
        addListener: vi.fn((event: string, cb: (id: string, batch: unknown) => void) => {
          if (event === 'receive') {
            receiveListener = cb;
          }
        }),
        removeListener: vi.fn((event: string, cb: unknown) => {
          if (event === 'receive' && receiveListener === cb) {
            receiveListener = undefined;
          }
        }),
        listenerCount: vi.fn(() => (receiveListener ? 1 : 0)),
        unsubscribe: vi.fn(),
        destroy: vi.fn(),
      },
      emitReceive: (batch: unknown) => {
        receiveListener?.('presence-id', batch);
      },
    };
  };

  const createMockConnection = (
    overrides?: Partial<{
      collection: string;
      queryParams: unknown;
    }>
  ) => {
    const presenceController = createMockPresence();
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      const query: Query<any> = {
        collection,
        query: queryParams,
        results: initData,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as any;
      return query;
    });

    return {
      connection: {
        createSubscribeQuery,
        getPresence: vi.fn(() => presenceController.presence),
      } as any,
      createSubscribeQuery,
      presenceController,
      collection: overrides?.collection ?? mockProps.collection,
      queryParams: overrides?.queryParams ?? mockProps.queryParams,
    };
  };

  // Keep the real query registry, event dispatch, and nextTick destroy callback.
  // Only the server transport is controlled so replies can arrive after release.
  const createQueryConnection = () => {
    const messages: Array<{ a: string; id: number; q?: unknown }> = [];
    const socket = {
      readyState: 1,
      send: (message: string) => messages.push(JSON.parse(message)),
      close: vi.fn(),
      onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
      onclose: undefined as (() => void) | undefined,
      onopen: undefined as (() => void) | undefined,
    };
    // ShareDB only uses these socket members; no browser WebSocket is opened.
    const transport = socket as unknown as ConstructorParameters<typeof Connection>[0];
    // ShareDB exposes this non-creating lookup at runtime, but omits its declaration.
    const connection = new Connection(transport) as Connection & {
      getExisting(collection: string, id: string): Doc | undefined;
    };
    const receive = (message: unknown) => socket.onmessage?.({ data: message });
    const handshake = () =>
      receive({ a: 'hs', protocol: 1, type: 'json0', id: 'sdk-query-cancellation' });
    handshake();
    return {
      connection,
      messages,
      receive,
      subscriptions: () => messages.filter((message) => message.a === 'qs'),
      reply: (id: number, recordId: string, name: string) =>
        receive({
          a: 'qs',
          id,
          data: [{ d: recordId, v: 1, type: 'json0', data: { id: recordId, name } }],
        }),
      reconnect: () => {
        socket.onclose?.();
        socket.onopen?.();
        handshake();
      },
    };
  };

  const initData = [
    createMockDoc({
      data: { id: '1', name: 'Instance 1' },
      collection: mockProps.collection,
      id: '1',
    }),
    createMockDoc({
      data: { id: '2', name: 'Instance 2' },
      collection: mockProps.collection,
      id: '2',
    }),
  ];

  const defaultInstance = initData.map((doc) => createTestInstance(doc.data, doc));

  // Mock the AppContext
  const mockAppContext = {
    connection: {
      createSubscribeQuery: vi.fn((collection: string, queryParams: any) => {
        const query: Query<any> = {
          collection,
          query: queryParams,
          results: initData,
          ready: true,
          sent: true,
          ...mockQueryMethods,
        } as any;
        return query;
      }),
    } as any,
    connected: true,
  };

  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRecords).mockReset();
  });

  it('switches a pending query without waiting for ready and ignores its late results', async () => {
    const client = createQueryConnection();
    const { result, rerender, unmount } = renderHook(
      ({ viewId }) =>
        useInstances({ ...mockProps, collection: 'rec_tblPendingSwitch', queryParams: { viewId } }),
      {
        wrapper: createUseInstancesWrap({ connection: client.connection, connected: true }),
        initialProps: { viewId: 'old' },
      }
    );
    const oldId = client.subscriptions()[0].id;

    rerender({ viewId: 'new' });

    expect(client.messages).toContainEqual({ a: 'qu', id: oldId });
    await waitFor(() => expect(client.subscriptions()).toHaveLength(2));
    const newId = client.subscriptions()[1].id;
    expect(client.subscriptions()[1].q).toEqual({ viewId: 'new' });

    await act(async () => client.reply(newId, 'new-record', 'Current view'));
    expect(result.current.instances.map(({ name }) => name)).toEqual(['Current view']);

    await act(async () => {
      client.reply(oldId, 'old-record', 'Obsolete view');
      client.receive({ a: 'q', id: oldId, diff: [{ type: 'remove', index: 0, howMany: 1 }] });
    });
    expect(result.current.instances.map(({ name }) => name)).toEqual(['Current view']);
    expect(client.connection.getExisting('rec_tblPendingSwitch', 'old-record')).toBeUndefined();
    unmount();
  });

  it('waits for pending metadata before unsubscribing and releases its late documents', async () => {
    const client = createQueryConnection();
    const collection = 'fld_tblPendingMetadata';
    const { unmount } = renderHook(() => useInstances({ ...mockProps, collection }), {
      wrapper: createUseInstancesWrap({ connection: client.connection, connected: true }),
    });
    const id = client.subscriptions()[0].id;
    unmount();
    expect(client.messages.filter((message) => message.a === 'qu')).toEqual([]);

    await act(async () => client.reply(id, 'field', 'Late field'));
    expect(client.messages.filter((message) => message.a === 'qu')).toEqual([{ a: 'qu', id }]);
    await waitFor(() => expect(client.connection.getExisting(collection, 'field')).toBeUndefined());
  });

  it('keeps shared live doc updates until the last ready owner leaves', async () => {
    const client = createQueryConnection();
    const wrapper = createUseInstancesWrap({ connection: client.connection, connected: true });
    const props = { ...mockProps, collection: 'sharedReadyRelease' };
    const first = renderHook(() => useInstances(props), { wrapper });
    const second = renderHook(() => useInstances(props), { wrapper });
    const id = client.subscriptions()[0].id;
    expect(client.subscriptions()).toHaveLength(1);
    await act(async () => client.reply(id, 'shared-record', 'Initial'));
    expect(first.result.current.instances.map(({ name }) => name)).toEqual(['Initial']);

    first.unmount();
    expect(client.messages.filter((message) => message.a === 'qu')).toEqual([]);

    expect(second.result.current.instances.map(({ name }) => name)).toEqual(['Initial']);
    await act(async () => {
      client.receive({
        a: 'op',
        c: props.collection,
        d: 'shared-record',
        v: 1,
        op: [{ p: ['name'], od: 'Initial', oi: 'Live update' }],
      });
    });
    expect(second.result.current.instances.map(({ name }) => name)).toEqual(['Live update']);
    expect(client.connection.getExisting(props.collection, 'shared-record')).toBeDefined();

    second.unmount();
    expect(client.messages.filter((message) => message.a === 'qu')).toEqual([{ a: 'qu', id }]);
    await waitFor(() =>
      expect(client.connection.getExisting(props.collection, 'shared-record')).toBeUndefined()
    );
  });

  it('releases the last pending owner immediately and remounts a fresh subscription', async () => {
    const client = createQueryConnection();
    const wrapper = createUseInstancesWrap({ connection: client.connection, connected: true });
    const props = { ...mockProps, collection: 'rec_tblSharedPendingRelease' };
    const first = renderHook(() => useInstances(props), { wrapper });
    const second = renderHook(() => useInstances(props), { wrapper });
    const oldId = client.subscriptions()[0].id;

    first.unmount();
    expect(client.messages.filter((message) => message.a === 'qu')).toEqual([]);
    second.unmount();
    expect(client.messages.filter((message) => message.a === 'qu')).toEqual([
      { a: 'qu', id: oldId },
    ]);

    const remounted = renderHook(() => useInstances(props), { wrapper });
    const newId = client.subscriptions()[1].id;
    expect(newId).not.toBe(oldId);
    await act(async () => {
      client.reply(oldId, 'old-record', 'Released');
      client.reply(newId, 'new-record', 'Remounted');
    });
    expect(remounted.result.current.instances.map(({ name }) => name)).toEqual(['Remounted']);
    remounted.unmount();
  });

  it('retains the current subscription across StrictMode replay and reconnect', async () => {
    const client = createQueryConnection();
    const Provider = createUseInstancesWrap({ connection: client.connection, connected: true });
    const collection = 'rec_tblStrictReconnectRelease';
    // React 19 only replays effects for a StrictMode boundary at the root, so let
    // testing-library mount the root in StrictMode instead of nesting it in the wrapper.
    const { result, unmount } = renderHook(() => useInstances({ ...mockProps, collection }), {
      wrapper: Provider,
      reactStrictMode: true,
    });
    const subscriptions = client.subscriptions();
    expect(subscriptions).toHaveLength(2);
    const oldId = subscriptions[0].id;
    const currentId = subscriptions[1].id;
    expect(client.messages).toContainEqual({ a: 'qu', id: oldId });

    // Let the old query's local destroy callback run before the live reply.
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
      client.reply(currentId, 'current-record', 'Before reconnect');
    });
    expect(result.current.instances.map(({ name }) => name)).toEqual(['Before reconnect']);

    await act(async () => client.reconnect());
    expect(client.subscriptions().map(({ id }) => id)).toEqual([oldId, currentId, currentId]);
    await act(async () => {
      client.reply(currentId, 'reconnected-record', 'After reconnect');
      client.reply(oldId, 'old-record', 'Obsolete StrictMode mount');
    });
    expect(result.current.instances.map(({ name }) => name)).toEqual(['After reconnect']);
    unmount();
    expect(client.messages.filter((message) => message.a === 'qu')).toEqual([
      { a: 'qu', id: oldId },
      { a: 'qu', id: currentId },
    ]);
  });

  it('should initialize with initData when connected is false', () => {
    const { result } = renderHook(() => useInstances({ ...mockProps, initData }), {
      wrapper: createUseInstancesWrap({ ...mockAppContext, connected: false }),
    });
    expect(result.current.instances.map((i) => i.doc)).toEqual(
      initData.map((doc) => createTestInstance(doc))
    );
  });

  it('seeds instances from initData while the subscription is pending, then hands over', () => {
    const seedProps = { ...mockProps, collection: 'seedTestCollection' };
    const pendingQuery: any = {
      collection: seedProps.collection,
      query: {},
      results: undefined,
      ready: false,
      sent: true,
      ...mockQueryMethods,
    };
    const connection = {
      createSubscribeQuery: vi.fn(() => pendingQuery),
    } as any;

    const seedData = [
      { id: 's1', name: 'Seed 1' },
      { id: 's2', name: 'Seed 2' },
    ];

    const { result, rerender } = renderHook(
      ({ init }: { init?: any[] }) => useInstances({ ...seedProps, initData: init }),
      {
        wrapper: createUseInstancesWrap({ connection, connected: true }),
        initialProps: { init: undefined as any[] | undefined },
      }
    );

    // subscription pending, no seed data yet → empty
    expect(result.current.instances).toEqual([]);

    // prefetched data arrives → instances seeded without doc backing
    rerender({ init: seedData });
    expect(result.current.instances.map((i) => i.id)).toEqual(['s1', 's2']);
    expect(result.current.instances.every((i) => i.doc === undefined)).toBe(true);

    // subscription delivers doc-backed results → seeds are replaced
    act(() => {
      pendingQuery.results = initData;
      pendingQuery.ready = true;
      const readyListener = mockQueryMethods.on.mock.calls.find((args: any) => args[0] === 'ready');
      readyListener?.[1]();
    });
    expect(result.current.instances).toEqual(defaultInstance);

    // a late seed (e.g. a react-query background refetch) must not clobber live data
    rerender({ init: [{ id: 'stale', name: 'Stale seed' }] });
    expect(result.current.instances).toEqual(defaultInstance);
  });

  it('never seeds from an empty initData (cannot fake an empty table)', () => {
    const pendingQuery: any = {
      collection: 'seedEmptyCollection',
      query: {},
      results: undefined,
      ready: false,
      sent: true,
      ...mockQueryMethods,
    };
    const connection = {
      createSubscribeQuery: vi.fn(() => pendingQuery),
    } as any;

    const { result, rerender } = renderHook(
      ({ init }: { init?: any[] }) =>
        useInstances({ ...mockProps, collection: 'seedEmptyCollection', initData: init }),
      {
        wrapper: createUseInstancesWrap({ connection, connected: true }),
        initialProps: { init: undefined as any[] | undefined },
      }
    );

    rerender({ init: [] });
    expect(result.current.instances).toEqual([]);
  });

  it('keeps subscription-delivered data intact across unrelated initData churn', () => {
    const { result, rerender } = renderHook(
      ({ init }: { init?: any[] }) => useInstances({ ...mockProps, initData: init }),
      {
        wrapper: createUseInstancesWrap(mockAppContext),
        initialProps: { init: undefined as any[] | undefined },
      }
    );

    // default mock query is ready immediately → doc-backed instances
    expect(result.current.instances).toEqual(defaultInstance);

    // any later initData (e.g. a react-query refetch) must be a no-op
    rerender({ init: [{ id: 'x1', name: 'Imposter' }] });
    expect(result.current.instances).toEqual(defaultInstance);
    rerender({ init: [{ id: 'x2', name: 'Imposter 2' }] });
    expect(result.current.instances).toEqual(defaultInstance);
  });

  it('resets seeded instances when the collection scope changes', () => {
    const connection = {
      createSubscribeQuery: vi.fn((collection: string, queryParams: unknown) => ({
        collection,
        query: queryParams,
        results: undefined,
        ready: false,
        sent: true,
        ...mockQueryMethods,
      })),
    } as any;

    const seedData = [{ id: 's1', name: 'Seed 1' }];

    const { result, rerender } = renderHook(
      ({ collection, init }: { collection: string; init?: any[] }) =>
        useInstances({ ...mockProps, collection, initData: init }),
      {
        wrapper: createUseInstancesWrap({ connection, connected: true }),
        initialProps: { collection: 'seedScopeA', init: seedData as any[] | undefined },
      }
    );

    expect(result.current.instances.map((i: any) => i.id)).toEqual(['s1']);

    // switching scope must not leak the previous scope's seeds, even though
    // they are doc-less (the plain 'clear' would keep them)
    rerender({ collection: 'seedScopeB', init: seedData });
    expect(result.current.instances).toEqual([]);
  });

  it('should create a subscribe query with correct parameters', () => {
    renderHook(() => useInstances(mockProps), {
      wrapper: createUseInstancesWrap(mockAppContext),
    });
    expect(mockAppContext.connection.createSubscribeQuery).toHaveBeenCalledWith(
      'testCollection',
      {}
    );
  });

  it('should update instances on ready event', () => {
    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createUseInstancesWrap(mockAppContext),
    });
    expect(result.current.instances.map((i) => i.doc)).toEqual(
      initData.map((doc) => createTestInstance(doc))
    );

    expect(result.current.instances).toEqual(defaultInstance);
  });

  it('should update instances on insert event', () => {
    const insertData = [
      createMockDoc({
        data: { id: '3', name: 'Instance 3' },
        collection: mockProps.collection,
        id: '3',
      }),
    ];

    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createUseInstancesWrap(mockAppContext),
    });
    expect(result.current.instances.map((i) => i.doc)).toEqual(
      initData.map((doc) => createTestInstance(doc))
    );

    act(() => {
      const insertListener = mockQueryMethods.on.mock.calls.find(
        (args: any) => args[0] === 'insert'
      );
      insertListener?.[1](insertData, 0);
    });

    expect(result.current.instances).toEqual([
      ...insertData.map((d) => createTestInstance(d.data, d)),
      ...defaultInstance,
    ]);
  });

  it('should update instances on remove event', () => {
    const removeData = [
      createMockDoc({
        data: { id: '2', name: 'Instance 2' },
        collection: mockProps.collection,
        id: '2',
      }),
    ];

    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createUseInstancesWrap(mockAppContext),
    });
    expect(result.current.instances.map((i) => i.doc)).toEqual(
      initData.map((doc) => createTestInstance(doc))
    );

    act(() => {
      const removeListener = mockQueryMethods.on.mock.calls.find(
        (args: any) => args[0] === 'remove'
      );
      removeListener?.[1](removeData, 1);
    });

    expect(result.current.instances).toEqual([defaultInstance[0]]);
  });

  it('should update instances on move event', () => {
    const moveData = [initData[1], initData[0]];

    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createUseInstancesWrap(mockAppContext),
    });
    expect(result.current.instances.map((i) => i.doc)).toEqual(
      initData.map((doc) => createTestInstance(doc))
    );

    act(() => {
      const moveListener = mockQueryMethods.on.mock.calls.find((args: any) => args[0] === 'move');
      moveListener?.[1](moveData, 1, 0);
    });

    expect(result.current.instances).toEqual(
      moveData.map((doc) => createTestInstance(doc.data, doc))
    );
  });

  it('should reconcile instances and extra on changed event', () => {
    const queryMethods = {
      on: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      removeListener: vi.fn(),
      destroy: vi.fn((cb?: () => void) => cb?.()),
    };
    const query = {
      collection: mockProps.collection,
      query: {},
      results: [...initData],
      extra: { groupPoints: [{ id: 'old-group' }] },
      ready: true,
      sent: true,
      ...queryMethods,
    } as unknown as Query<any>;
    const connection = {
      createSubscribeQuery: vi.fn(() => query),
      getPresence: vi.fn(() => createMockPresence().presence),
    } as any;

    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
    });

    expect(result.current.instances.map((instance) => instance.id)).toEqual(['1', '2']);

    act(() => {
      query.results = [initData[1], initData[0]];
      query.extra = { groupPoints: [{ id: 'new-group' }] };
      const changedListener = queryMethods.on.mock.calls.find((args: any) => args[0] === 'changed');
      changedListener?.[1](query.results);
    });

    expect(result.current.instances.map((instance) => instance.id)).toEqual(['2', '1']);
    expect(result.current.extra).toEqual({ groupPoints: [{ id: 'new-group' }] });
  });

  it('doc on op', () => {
    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createUseInstancesWrap(mockAppContext),
    });
    expect(result.current.instances.map((i) => i.doc)).toEqual(
      initData.map((doc) => createTestInstance(doc))
    );

    act(() => {
      const opListener = result.current.instances[0].doc.on.mock.calls.find(
        (args: any) => args[0] === 'op batch'
      );
      opListener[1](['op op op']);
    });
    expect(createTestInstance).toHaveBeenCalledWith(
      result.current.instances[0].doc.data,
      result.current.instances[0].doc
    );
  });

  it('ignores op-batch updates for docs whose data has been cleared before remove', () => {
    const presenceController = createMockPresence();
    const trackedDoc = createTrackedDoc({
      data: { id: '1', name: 'Instance 1' },
      collection: mockProps.collection,
      id: '1',
    });
    const siblingDoc = createTrackedDoc({
      data: { id: '2', name: 'Instance 2' },
      collection: mockProps.collection,
      id: '2',
    });
    const queryMethods = {
      on: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      removeListener: vi.fn(),
      destroy: vi.fn((cb?: () => void) => cb?.()),
    };
    const connection = {
      createSubscribeQuery: vi.fn((collection: string, queryParams: unknown) => {
        return {
          collection,
          query: queryParams,
          results: [trackedDoc.doc, siblingDoc.doc],
          ready: true,
          sent: true,
          ...queryMethods,
        } as unknown as Query<any>;
      }),
      getPresence: vi.fn(() => presenceController.presence),
    } as any;

    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
    });

    act(() => {
      trackedDoc.doc.data = undefined;
      const opListener = result.current.instances[0].doc.on.mock.calls.find(
        (args: any) => args[0] === 'op batch'
      );
      expect(() => opListener?.[1]([])).not.toThrow();
    });

    expect(result.current.instances).toHaveLength(2);
    expect(result.current.instances[0]?.doc).toBe(trackedDoc.doc);

    act(() => {
      const removeListener = queryMethods.on.mock.calls.find((args: any) => args[0] === 'remove');
      removeListener?.[1]([trackedDoc.doc], 0);
    });

    expect(result.current.instances).toHaveLength(1);
    expect(result.current.instances[0]?.doc).toBe(siblingDoc.doc);
  });

  it('recreates record queries on schema-driven setField presence with fieldIds', async () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'rec_tblSchemaRefresh01',
      });

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh01',
            field: {
              id: 'fldSchemaRefresh01',
            },
            fieldIds: ['fldSchemaRefresh01'],
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(2);
  });

  it('does not recreate field queries on schema-driven setField presence with fieldIds', () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'fld_tblSchemaRefresh07',
      });

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh07',
            field: {
              id: 'fldSchemaRefresh07',
            },
            fieldIds: ['fldSchemaRefresh07'],
          },
        },
      ]);
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
  });

  it('keeps field instances stable during schema refresh until field doc ops arrive', async () => {
    const presenceController = createMockPresence();
    const staleDoc = createMockDoc({
      data: { id: 'fldOld', name: 'Old Field' },
      collection: 'fld_tblSchemaRefresh09',
      id: 'fldOld',
    });
    const createSubscribeQuery = vi.fn(() => {
      return {
        collection: 'fld_tblSchemaRefresh09',
        query: {},
        results: [staleDoc],
        ready: true,
        sent: true,
        on: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(),
        destroy: vi.fn((cb?: () => void) => cb?.()),
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as any;

    const { result } = renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'fld_tblSchemaRefresh09',
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(result.current.instances[0]?.doc).toBe(staleDoc);

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh09',
            field: {
              id: 'fldSchemaRefresh09',
            },
            fieldIds: ['fldSchemaRefresh09'],
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
    expect(result.current.instances[0]?.doc).toBe(staleDoc);
  });

  it('does not recreate view queries on schema-driven setField presence with fieldIds', () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'viw_tblSchemaRefresh08',
      });

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh08',
            field: {
              id: 'fldSchemaRefresh08',
            },
            fieldIds: ['fldSchemaRefresh08'],
          },
        },
      ]);
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
  });

  it('refreshes projected record fields in place on schema-driven setField presence with updatedProperties', async () => {
    const presenceController = createMockPresence();
    const docs = [
      createMockDoc({
        data: { id: 'rec1', fields: { fldSchemaRefresh04: '待开始' } },
        collection: 'rec_tblSchemaRefresh04',
        id: 'rec1',
      }),
      createMockDoc({
        data: { id: 'rec2', fields: {} },
        collection: 'rec_tblSchemaRefresh04',
        id: 'rec2',
      }),
    ];
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: docs,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as any;

    vi.mocked(getRecords).mockResolvedValue({
      data: {
        records: [
          { id: 'rec1', fields: { fldSchemaRefresh04: ['待开始'] } },
          { id: 'rec2', fields: {} },
        ],
      },
    } as any);

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblSchemaRefresh04',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh04',
            field: {
              id: 'fldSchemaRefresh04',
              updatedProperties: ['options'],
              options: {
                relationship: 'manyMany',
                isOneWay: true,
              },
            },
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getRecords)).toHaveBeenCalledWith(
      'tblSchemaRefresh04',
      expect.objectContaining({
        fieldKeyType: FieldKeyType.Id,
        projection: ['fldSchemaRefresh04'],
      })
    );
    expect(docs[0].data.fields.fldSchemaRefresh04).toEqual(['待开始']);
  });

  it('refreshes projected record fields in place on legacy v1 setField presence with options changes', async () => {
    const presenceController = createMockPresence();
    const docs = [
      createMockDoc({
        data: { id: 'rec1', fields: { fldSchemaRefresh05: ['进行中'] } },
        collection: 'rec_tblSchemaRefresh05',
        id: 'rec1',
      }),
    ];
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: docs,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as any;

    vi.mocked(getRecords).mockResolvedValue({
      data: {
        records: [{ id: 'rec1', fields: { fldSchemaRefresh05: '进行中' } }],
      },
    } as any);

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblSchemaRefresh05',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh05',
            field: {
              id: 'fldSchemaRefresh05',
              options: {
                oldValue: { relationship: 'manyOne', isOneWay: false },
                newValue: { relationship: 'manyMany', isOneWay: true },
              },
            },
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
    expect(docs[0].data.fields.fldSchemaRefresh05).toEqual('进行中');
  });

  it('T6007 preserves optimistic select values when projected setField refresh omits the field', async () => {
    const presenceController = createMockPresence();
    const docs = [
      createMockDoc({
        data: { id: 'rec1', fields: { fldSchemaRefreshT6007: '5555' } },
        collection: 'rec_tblSchemaRefreshT6007',
        id: 'rec1',
      }),
    ];
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: docs,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<IRecord>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as unknown as Connection;

    // getRecords omits null/empty projected fields entirely.
    vi.mocked(getRecords).mockResolvedValue({
      data: {
        records: [{ id: 'rec1', fields: {} }],
      },
    } as never);

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblSchemaRefreshT6007',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefreshT6007',
            field: {
              id: 'fldSchemaRefreshT6007',
              options: {
                oldValue: { choices: [{ name: '4444', id: 'cho4444', color: 'blueLight1' }] },
                newValue: {
                  choices: [
                    { name: '4444', id: 'cho4444', color: 'blueLight1' },
                    { name: '5555', id: 'cho5555', color: 'tealBright' },
                  ],
                },
              },
            },
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getRecords)).toHaveBeenCalledWith(
      'tblSchemaRefreshT6007',
      expect.objectContaining({
        fieldKeyType: FieldKeyType.Id,
        projection: ['fldSchemaRefreshT6007'],
      })
    );
    // Must keep the optimistic local value instead of treating omission as clear.
    expect(docs[0].data.fields.fldSchemaRefreshT6007).toBe('5555');
  });

  it('refreshes projected record fields in place on legacy v1 setField presence with type changes', async () => {
    const presenceController = createMockPresence();
    const docs = [
      createMockDoc({
        data: { id: 'rec1', fields: { fldSchemaRefresh12: 'ready' } },
        collection: 'rec_tblSchemaRefresh12',
        id: 'rec1',
      }),
    ];
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: docs,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as any;

    vi.mocked(getRecords).mockResolvedValue({
      data: {
        records: [{ id: 'rec1', fields: { fldSchemaRefresh12: 'ready' } }],
      },
    } as any);

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblSchemaRefresh12',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh12',
            field: {
              id: 'fldSchemaRefresh12',
              type: {
                oldValue: 'formula',
                newValue: 'singleLineText',
              },
            },
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getRecords)).toHaveBeenCalledWith(
      'tblSchemaRefresh12',
      expect.objectContaining({
        fieldKeyType: FieldKeyType.Id,
        projection: ['fldSchemaRefresh12'],
      })
    );
    expect(docs[0].data.fields.fldSchemaRefresh12).toEqual('ready');
  });

  it('notifies tracked record docs through op batch during projected refresh', async () => {
    const presenceController = createMockPresence();
    const trackedDoc = createTrackedDoc({
      data: { id: 'rec1', fields: { fldSchemaRefresh11: '待开始' } },
      collection: 'rec_tblSchemaRefresh11',
      id: 'rec1',
    });
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: [trackedDoc.doc],
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as any;

    vi.mocked(getRecords).mockResolvedValue({
      data: {
        records: [{ id: 'rec1', fields: { fldSchemaRefresh11: ['待开始'] } }],
      },
    } as any);

    const { result } = renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblSchemaRefresh11',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh11',
            field: {
              id: 'fldSchemaRefresh11',
              updatedProperties: ['options'],
            },
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(trackedDoc.doc.emit).toHaveBeenCalledWith('op batch', [], false);
    expect(trackedDoc.state.emittedOpBatches).toEqual([[]]);
    expect(result.current.instances[0]?.doc.data.fields.fldSchemaRefresh11).toEqual(['待开始']);
  });

  it('updates reducer state even when projected refresh op batch listeners do not feed back', async () => {
    const presenceController = createMockPresence();
    const trackedDoc = createTrackedDoc(
      {
        data: { id: 'rec1', fields: { fldSchemaRefresh12: '待开始' } },
        collection: 'rec_tblSchemaRefresh12',
        id: 'rec1',
      },
      {
        emitInvokesHandlers: false,
      }
    );
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: [trackedDoc.doc],
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as any;
    const customFactory = vi.fn((data: any, doc?: any) => ({
      id: data.id,
      renderedValue: JSON.stringify(data.fields?.fldSchemaRefresh12 ?? null),
      doc,
    }));

    vi.mocked(getRecords).mockResolvedValue({
      data: {
        records: [{ id: 'rec1', fields: { fldSchemaRefresh12: ['待开始'] } }],
      },
    } as any);

    const { result } = renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblSchemaRefresh12',
          queryParams: {},
          factory: customFactory,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(result.current.instances[0]?.renderedValue).toBe('"待开始"');

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh12',
            field: {
              id: 'fldSchemaRefresh12',
              updatedProperties: ['options'],
            },
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(trackedDoc.doc.emit).toHaveBeenCalledWith('op batch', [], false);
    expect(result.current.instances[0]?.renderedValue).toBe('["待开始"]');
  });

  it('falls back to recreating record queries when projected refresh changes record order', async () => {
    const presenceController = createMockPresence();
    const staleDocs = [
      createMockDoc({
        data: { id: 'rec1', fields: { fldSchemaRefresh10: '待开始' } },
        collection: 'rec_tblSchemaRefresh10',
        id: 'rec1',
      }),
      createMockDoc({
        data: { id: 'rec2', fields: {} },
        collection: 'rec_tblSchemaRefresh10',
        id: 'rec2',
      }),
    ];
    const freshDocs = [
      createMockDoc({
        data: { id: 'rec2', fields: {} },
        collection: 'rec_tblSchemaRefresh10',
        id: 'rec2',
      }),
      createMockDoc({
        data: { id: 'rec1', fields: { fldSchemaRefresh10: ['待开始'] } },
        collection: 'rec_tblSchemaRefresh10',
        id: 'rec1',
      }),
    ];
    let subscribeCallCount = 0;
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      subscribeCallCount += 1;
      return {
        collection,
        query: queryParams,
        results: subscribeCallCount === 1 ? staleDocs : freshDocs,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as any;

    vi.mocked(getRecords).mockResolvedValue({
      data: {
        records: [
          { id: 'rec2', fields: {} },
          { id: 'rec1', fields: { fldSchemaRefresh10: ['待开始'] } },
        ],
      },
    } as any);

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblSchemaRefresh10',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh10',
            field: {
              id: 'fldSchemaRefresh10',
              updatedProperties: ['options'],
              options: {
                choices: [],
              },
            },
          },
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(2);
  });

  it('releases stale record docs before recreating a schema refresh query', async () => {
    const presenceController = createMockPresence();
    const staleDoc = createTrackedDoc({
      data: { id: '1', value: null },
      collection: 'rec_tblSchemaRefresh03',
      id: '1',
    });
    const freshDoc = createTrackedDoc({
      data: { id: '1', value: 2 },
      collection: 'rec_tblSchemaRefresh03',
      id: '1',
    });
    const queryMethods = {
      on: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      removeListener: vi.fn(),
    };
    let subscribeCallCount = 0;
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      subscribeCallCount += 1;
      const results =
        subscribeCallCount === 1 || !staleDoc.state.destroyed ? [staleDoc.doc] : [freshDoc.doc];

      return {
        collection,
        query: queryParams,
        results,
        ready: true,
        sent: true,
        ...queryMethods,
        destroy: vi.fn((cb?: () => void) => cb?.()),
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => presenceController.presence),
    } as any;

    const { result } = renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblSchemaRefresh03',
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(result.current.instances[0]?.doc).toBe(staleDoc.doc);

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh03',
            field: {
              id: 'fldSchemaRefresh03',
            },
            fieldIds: ['fldSchemaRefresh03'],
          },
        },
      ]);
      await Promise.resolve();
    });

    expect(staleDoc.state.destroyed).toBe(true);
    expect(createSubscribeQuery).toHaveBeenCalledTimes(2);
    expect(result.current.instances[0]?.doc).toBe(freshDoc.doc);
  });

  it('waits for async query destroy before recreating a schema refresh query', async () => {
    vi.useFakeTimers();
    try {
      const presenceController = createMockPresence();
      const staleDoc = createTrackedDoc({
        data: { id: '1', value: 'stale' },
        collection: 'rec_tblSchemaRefresh07',
        id: '1',
      });
      const freshDoc = createTrackedDoc({
        data: { id: '1', value: 'fresh' },
        collection: 'rec_tblSchemaRefresh07',
        id: '1',
      });
      const queryMethods = {
        on: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn(),
        removeListener: vi.fn(),
      };
      let subscribeCallCount = 0;
      const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
        subscribeCallCount += 1;
        const results =
          subscribeCallCount === 1 || !staleDoc.state.destroyed ? [staleDoc.doc] : [freshDoc.doc];

        return {
          collection,
          query: queryParams,
          results,
          ready: true,
          sent: true,
          ...queryMethods,
          destroy: vi.fn((cb?: () => void) => {
            setTimeout(() => cb?.(), 0);
          }),
        } as unknown as Query<any>;
      });
      const connection = {
        createSubscribeQuery,
        getPresence: vi.fn(() => presenceController.presence),
      } as any;

      const { result } = renderHook(
        () =>
          useInstances({
            ...mockProps,
            collection: 'rec_tblSchemaRefresh07',
          }),
        {
          wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
        }
      );

      expect(result.current.instances[0]?.doc).toBe(staleDoc.doc);

      await act(async () => {
        presenceController.emitReceive([
          {
            actionKey: 'setField',
            payload: {
              tableId: 'tblSchemaRefresh07',
              field: {
                id: 'fldSchemaRefresh07',
              },
              fieldIds: ['fldSchemaRefresh07'],
            },
          },
        ]);
        await Promise.resolve();
      });
      await act(async () => {
        await vi.runAllTimersAsync();
        await Promise.resolve();
      });

      expect(staleDoc.state.destroyed).toBe(true);
      expect(createSubscribeQuery).toHaveBeenCalledTimes(2);
      expect(result.current.instances[0]?.doc).toBe(freshDoc.doc);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores setRecord presence without schema refresh fieldIds', () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'rec_tblSchemaRefresh02',
      });

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'setRecord',
        },
      ]);
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
  });

  // op-carrying mutations are propagated by the server-side query poll and
  // doc op pushes; resubscribing here would re-query records on every cell
  // edit for any filtered/sorted/grouped subscription
  it('does not recreate record queries when a bare setRecord presence arrives', async () => {
    const { connection, createSubscribeQuery, presenceController, collection } =
      createMockConnection({
        collection: 'rec_tblSchemaRefresh12',
        queryParams: {
          groupBy: [{ fieldId: 'fldStatus', order: 'asc' }],
        },
      });

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams: {
            groupBy: [{ fieldId: 'fldStatus', order: 'asc' }],
          },
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      presenceController.emitReceive([
        {
          actionKey: 'setRecord',
        },
        {
          actionKey: 'setRecord',
          payload: { fieldIds: ['fldAnything000001'] },
        },
      ]);
      await Promise.resolve();
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
  });

  it('removes projected record instances when deleteRecord presence carries record ids', () => {
    const { connection, presenceController, collection, queryParams } = createMockConnection({
      collection: 'rec_tblSchemaRefresh10',
    });

    const { result } = renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(result.current.instances.map((instance) => instance.id)).toEqual(['1', '2']);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'deleteRecord',
          payload: {
            tableId: 'tblSchemaRefresh10',
            recordIds: ['2'],
            skipRealtime: true,
          },
        },
      ]);
    });

    expect(result.current.instances.map((instance) => instance.id)).toEqual(['1']);
  });

  it('refreshes the record query only when the final large setRecord chunk arrives', async () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'rec_tblSchemaRefresh11',
      });

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'setRecord',
          payload: {
            tableId: 'tblSchemaRefresh11',
            recordIds: ['1', '2'],
            skipRealtime: true,
            totalChunkCount: 2,
            chunkIndex: 0,
          },
        },
      ]);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'setRecord',
          payload: {
            tableId: 'tblSchemaRefresh11',
            recordIds: ['1', '2'],
            skipRealtime: true,
            totalChunkCount: 2,
            chunkIndex: 1,
          },
        },
      ]);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(createSubscribeQuery).toHaveBeenCalledTimes(2);
  });

  it('refreshes the record query only when the final large addRecord chunk arrives', async () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'rec_tblSchemaRefresh12',
      });

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'addRecord',
          payload: {
            tableId: 'tblSchemaRefresh12',
            recordIds: ['3'],
            skipRealtime: true,
            totalChunkCount: 3,
            chunkIndex: 1,
          },
        },
      ]);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'addRecord',
          payload: {
            tableId: 'tblSchemaRefresh12',
            recordIds: ['4'],
            skipRealtime: true,
            totalChunkCount: 3,
            chunkIndex: 2,
          },
        },
      ]);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(createSubscribeQuery).toHaveBeenCalledTimes(2);
  });

  it('ignores setField presence without schema refresh properties', () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'rec_tblSchemaRefresh06',
      });

    renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection,
          queryParams,
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);

    act(() => {
      presenceController.emitReceive([
        {
          actionKey: 'setField',
          payload: {
            tableId: 'tblSchemaRefresh06',
            field: {
              id: 'fldSchemaRefresh06',
              updatedProperties: ['name'],
              name: 'Renamed',
            },
          },
        },
      ]);
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
  });

  it('returns false when a fill is superseded by a newer fill', async () => {
    const docs = [
      createMockDoc({
        data: { id: 'rec1', fields: {} },
        collection: 'rec_tblFillCancel',
        id: 'rec1',
      }),
    ];
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: docs,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => createMockPresence().presence),
    } as any;

    let resolveFirst: ((value: unknown) => void) | undefined;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(getRecords)
      .mockImplementationOnce(() => firstResponse as never)
      .mockResolvedValueOnce({
        data: { records: [{ id: 'rec1', fields: { fldB: 'new' } }] },
      } as never);

    const { result } = renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblFillCancel',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    let firstResult: boolean | undefined;
    let secondResult: boolean | undefined;
    await act(async () => {
      const firstFill = result.current.fillProjectedRecordFields(['fldA']);
      const secondFill = result.current.fillProjectedRecordFields(['fldB']);
      resolveFirst?.({
        data: { records: [{ id: 'rec1', fields: { fldA: 'stale' } }] },
      });
      firstResult = await firstFill;
      secondResult = await secondFill;
    });

    expect(firstResult).toBe(false);
    expect(secondResult).toBe(true);
    expect(docs[0].data.fields.fldA).toBeUndefined();
    expect(docs[0].data.fields.fldB).toBe('new');
  });

  it('returns false when fill runs before subscribe docs exist', async () => {
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: [],
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => createMockPresence().presence),
    } as any;

    vi.mocked(getRecords).mockResolvedValue({
      data: { records: [{ id: 'rec1', fields: { fldA: 'value' } }] },
    } as never);

    const { result } = renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblFillEmpty',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    let fillResult: boolean | undefined;
    await act(async () => {
      fillResult = await result.current.fillProjectedRecordFields(['fldA']);
    });

    expect(fillResult).toBe(false);
  });

  it.each(['fill', 'refresh'] as const)(
    'hydrates shared record fields through the share boundary during %s',
    async (mode) => {
      const collection = `rec_tblShareHydration${mode}`;
      const tableId = collection.slice(4);
      const presenceController = createMockPresence();
      const docs = [
        createMockDoc({
          id: 'recShared',
          collection,
          data: { id: 'recShared', fields: { fldPrefix: 'live prefix' } },
        }),
      ];
      const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => ({
        collection,
        query: queryParams,
        results: docs,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      }));
      // Only subscription and presence transport are needed by this hook fixture.
      const connection = {
        createSubscribeQuery,
        getPresence: vi.fn(() => presenceController.presence),
      } as unknown as Connection;
      const Provider = createUseInstancesWrap({ ...mockAppContext, connection });
      const actual = await vi.importActual<{ getRecords: typeof getRecords }>('@teable/openapi');
      vi.mocked(getRecords).mockImplementation(actual.getRecords);
      const originalAdapter = axios.defaults.adapter;
      // Exercise the real API clients against the share HTTP boundary: the workspace
      // endpoint and caller-controlled view scope are not allowed for a share visitor.
      axios.defaults.adapter = async (config) => {
        if (config.url !== '/share/shrHydration/view/records') {
          throw new HttpError('This endpoint cannot be used with X-Tea-Share-View', 403);
        }
        if ('viewId' in config.params || 'ignoreViewQuery' in config.params) {
          throw new HttpError('The shared view owns the query scope', 400);
        }
        return {
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: { records: [{ id: 'recShared', fields: { fldLate: 'late value' } }] },
        };
      };

      try {
        const { result } = renderHook(
          () =>
            useInstances({
              ...mockProps,
              collection,
              queryParams: {
                type: 'rec',
                viewId: 'viwShared',
                ignoreViewQuery: true,
                skip: 64,
                take: 64,
                projection: ['fldPrefix'],
              },
            }),
          {
            wrapper: ({ children }) => (
              <Provider>
                <ShareViewContext.Provider
                  value={{ shareId: 'shrHydration', tableId, fields: [], records: [] }}
                >
                  {children}
                </ShareViewContext.Provider>
              </Provider>
            ),
          }
        );

        await act(async () => {
          if (mode === 'fill') {
            await result.current.fillProjectedRecordFields(['fldLate']);
          } else {
            presenceController.emitReceive([
              {
                actionKey: 'setField',
                payload: {
                  tableId,
                  field: { id: 'fldLate', updatedProperties: ['options'] },
                },
              },
            ]);
          }
        });

        await waitFor(() =>
          expect(result.current.instances[0].fields).toEqual({
            fldPrefix: 'live prefix',
            fldLate: 'late value',
          })
        );
        expect(createSubscribeQuery).toHaveBeenCalledTimes(1);
      } finally {
        axios.defaults.adapter = originalAdapter;
      }
    }
  );

  it('does not hydrate a foreign table through an inherited share context', async () => {
    const { connection } = createMockConnection({ collection: 'rec_tblForeignShare' });
    const Provider = createUseInstancesWrap({ ...mockAppContext, connection });
    const { result } = renderHook(
      () => useInstances({ ...mockProps, collection: 'rec_tblForeignShare' }),
      {
        wrapper: ({ children }) => (
          <Provider>
            <ShareViewContext.Provider
              value={{
                shareId: 'shrOuter',
                tableId: 'tblOuterShare',
                fields: [],
                records: [],
              }}
            >
              {children}
            </ShareViewContext.Provider>
          </Provider>
        ),
      }
    );
    const request = vi.spyOn(axios, 'get');
    try {
      await act(async () => {
        expect(await result.current.fillProjectedRecordFields(['fldLate'])).toBe(false);
      });
      expect(getRecords).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });

  it('fills the field permissions a late viewport column needs to stay readable and editable', async () => {
    const docs = [
      createMockDoc({
        data: {
          id: 'rec1',
          fields: { fldPrefix: 'prefix' },
          permissions: { read: { fldPrefix: true }, update: { fldPrefix: true } },
        },
        collection: 'rec_tblFillPermissions',
        id: 'rec1',
      }),
    ];
    const createSubscribeQuery = vi.fn((collection: string, queryParams: unknown) => {
      return {
        collection,
        query: queryParams,
        results: docs,
        ready: true,
        sent: true,
        ...mockQueryMethods,
      } as unknown as Query<any>;
    });
    const connection = {
      createSubscribeQuery,
      getPresence: vi.fn(() => createMockPresence().presence),
    } as any;

    vi.mocked(getRecords).mockResolvedValue({
      data: {
        records: [
          {
            id: 'rec1',
            fields: { fldLate: 'late' },
            permissions: { read: { fldLate: true }, update: { fldLate: true } },
          },
        ],
      },
    } as never);

    const { result } = renderHook(
      () =>
        useInstances({
          ...mockProps,
          collection: 'rec_tblFillPermissions',
          queryParams: {},
        }),
      {
        wrapper: createUseInstancesWrap({ ...mockAppContext, connection }),
      }
    );

    await act(async () => {
      await result.current.fillProjectedRecordFields(['fldLate']);
    });

    const permissions = docs[0].data.permissions;
    expect(permissions.read.fldLate).toBe(true);
    expect(permissions.update.fldLate).toBe(true);
    expect(RecordInstance.isHidden(permissions, 'fldLate')).toBe(false);
    expect(RecordInstance.isLocked(permissions, 'fldLate')).toBe(false);
  });
});
