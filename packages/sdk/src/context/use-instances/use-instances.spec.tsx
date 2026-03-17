/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook } from '@testing-library/react';
import type { Connection, Query } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createAppContext } from '../__tests__/createAppContext';
import { createConnectionContext } from '../__tests__/createConnectionContext';
import { createSessionContext } from '../__tests__/createSessionContext';
import type { IAppContext } from '../app';
import type { IUseInstancesProps } from './useInstances';
import { useInstances } from './useInstances';

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
    destroy: vi.fn(),
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

  const createTrackedDoc = (arg: Record<string, any>) => {
    const state = {
      opBatchListeners: 0,
      destroyed: false,
    };

    const doc = {
      ...arg,
      on: vi.fn((event: string) => {
        if (event === 'op batch') {
          state.opBatchListeners += 1;
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
      removeListener: vi.fn((event: string) => {
        if (event === 'op batch' && state.opBatchListeners > 0) {
          state.opBatchListeners -= 1;
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
  });

  it('should initialize with initData when connected is false', () => {
    const { result } = renderHook(() => useInstances({ ...mockProps, initData }), {
      wrapper: createUseInstancesWrap({ ...mockAppContext, connected: false }),
    });
    expect(result.current.instances.map((i) => i.doc)).toEqual(
      initData.map((doc) => createTestInstance(doc))
    );
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

  it('recreates record queries on schema-driven setField presence with fieldIds', () => {
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

    act(() => {
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
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(2);
  });

  it('recreates record queries on schema-driven setField presence with updatedProperties', () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'rec_tblSchemaRefresh04',
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
    });

    expect(createSubscribeQuery).toHaveBeenCalledTimes(2);
  });

  it('recreates record queries on legacy v1 setField presence with options changes', () => {
    const { connection, createSubscribeQuery, presenceController, collection, queryParams } =
      createMockConnection({
        collection: 'rec_tblSchemaRefresh05',
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
});
