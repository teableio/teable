/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Query } from '@teable/sharedb/lib/client';
import { act, renderHook } from '@testing-library/react';
import { createAppContext } from '../__test__/createAppContext';
import type { IUseInstancesProps } from './useInstances';
import { useInstances } from './useInstances';

describe('useInstances hook', () => {
  const mockQueryMethods = {
    on: jest.fn(),
    once: jest.fn(),
    removeAllListeners: jest.fn(),
    destroy: jest.fn(),
  };

  const createMockDoc = (arg: Record<string, any>) =>
    ({
      ...arg,
      on: jest.fn(),
      destroy: jest.fn(),
      removeEventListener: jest.fn(),
      removeListener: jest.fn(),
    } as any);

  // Factory function for creating test data instances
  const createTestInstance = jest.fn((data: any, doc?: any) => {
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
      createSubscribeQuery: jest.fn((collection: string, queryParams: any) => {
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
    jest.clearAllMocks();
  });

  it('should initialize with initData when connected is false', () => {
    const { result } = renderHook(() => useInstances({ ...mockProps, initData }), {
      wrapper: createAppContext({ ...mockAppContext, connected: false }),
    });
    expect(result.current).toEqual(initData.map((doc) => createTestInstance(doc)));
  });

  it('should create a subscribe query with correct parameters', () => {
    renderHook(() => useInstances(mockProps), {
      wrapper: createAppContext(mockAppContext),
    });
    expect(mockAppContext.connection.createSubscribeQuery).toHaveBeenCalledWith(
      'testCollection',
      {}
    );
  });

  it('should update instances on ready event', () => {
    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createAppContext(mockAppContext),
    });
    expect(result.current).toEqual([]);

    act(() => {
      const readyListener = mockQueryMethods.on.mock.calls.find((args: any) => args[0] === 'ready');
      readyListener[1]();
    });

    expect(result.current).toEqual(defaultInstance);
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
      wrapper: createAppContext(mockAppContext),
    });
    expect(result.current).toEqual([]);

    act(() => {
      const readyListener = mockQueryMethods.on.mock.calls.find((args: any) => args[0] === 'ready');
      readyListener[1]();
      const insertListener = mockQueryMethods.on.mock.calls.find(
        (args: any) => args[0] === 'insert'
      );
      insertListener[1](insertData, 0);
    });

    expect(result.current).toEqual([
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
      wrapper: createAppContext(mockAppContext),
    });
    expect(result.current).toEqual([]);

    act(() => {
      const readyListener = mockQueryMethods.on.mock.calls.find((args: any) => args[0] === 'ready');
      readyListener[1]();

      const removeListener = mockQueryMethods.on.mock.calls.find(
        (args: any) => args[0] === 'remove'
      );
      removeListener[1](removeData, 1);
    });

    expect(result.current).toEqual([defaultInstance[0]]);
  });

  it('should update instances on move event', () => {
    const moveData = [initData[1], initData[0]];

    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createAppContext(mockAppContext),
    });
    expect(result.current).toEqual([]);

    act(() => {
      const readyListener = mockQueryMethods.on.mock.calls.find((args: any) => args[0] === 'ready');
      readyListener[1]();

      const moveListener = mockQueryMethods.on.mock.calls.find((args: any) => args[0] === 'move');
      moveListener[1](moveData, 1, 0);
    });

    expect(result.current).toEqual(moveData.map((doc) => createTestInstance(doc.data, doc)));
  });

  it('doc on op', () => {
    const { result } = renderHook(() => useInstances(mockProps), {
      wrapper: createAppContext(mockAppContext),
    });
    expect(result.current).toEqual([]);

    act(() => {
      const readyListener = mockQueryMethods.on.mock.calls.find((args: any) => args[0] === 'ready');
      readyListener[1]();
    });

    act(() => {
      const opListener = result.current[0].doc.on.mock.calls.find((args: any) => args[0] === 'op');
      opListener[1](['op op op']);
    });
    expect(createTestInstance).toHaveBeenCalledWith(
      result.current[0].doc.data,
      result.current[0].doc
    );
  });
});
