/* eslint-disable @typescript-eslint/no-explicit-any */
import { FieldKeyType } from '@teable/core';
import { getRecords } from '@teable/openapi';
import { act, renderHook } from '@testing-library/react';
import type { Connection, Query } from 'sharedb/lib/client';
import { vi } from 'vitest';
import { createAppContext } from '../__tests__/createAppContext';
import { createConnectionContext } from '../__tests__/createConnectionContext';
import { createSessionContext } from '../__tests__/createSessionContext';
import type { IAppContext } from '../app';
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
});
