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

  // Factory function for creating test data instances
  const createTestInstance = vi.fn((data: any, doc?: any) => {
    return { ...data, doc };
  });

  const mockProps: IUseInstancesProps<any, any> = {
    collection: 'testCollection',
    factory: createTestInstance,
    queryParams: {},
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
});
