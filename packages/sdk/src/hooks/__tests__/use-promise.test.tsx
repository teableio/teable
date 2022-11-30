import { render, screen } from '@testing-library/react';
import { act, renderHook } from '@testing-library/react-hooks';
import type { FC } from 'react';
import { usePromise } from '../use-promise';

describe('usePromise', () => {
  describe('hook', () => {
    it('should load, return the promise response and rerender', async () => {
      const deps = { slug: 'b' };
      const expected = { value: 'cool' };
      type Deps = typeof deps;
      const callback = jest.fn();
      const promiseFn = async (deps: Deps) => {
        callback(deps);
        return expected;
      };

      const { result, waitForNextUpdate, rerender } = renderHook(() =>
        usePromise(promiseFn, deps)
      );
      // initial data
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toStrictEqual(true);
      expect(result.current.error).toBeNull();

      // resolved data
      await waitForNextUpdate();

      expect(callback).toHaveBeenCalledTimes(1);

      expect(result.current.data).toStrictEqual(expected);
      expect(result.current.isLoading).toStrictEqual(false);
      expect(result.current.error).toBeNull();

      rerender();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(result.current.data).toStrictEqual(expected);
      expect(result.current.isLoading).toStrictEqual(false);
      expect(result.current.error).toBeNull();
    });

    it('should set error when promise fails', async () => {
      const callback = jest.fn();
      const promiseFn = async () => {
        callback();
        throw new Error('cool');
      };

      const { result, waitForNextUpdate } = renderHook(() =>
        usePromise(promiseFn, {})
      );
      // initial data
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toStrictEqual(true);
      expect(result.current.error).toBeNull();

      // resolved data
      await waitForNextUpdate();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.isLoading).toStrictEqual(false);
      expect(result.current.error?.message).toStrictEqual('cool');
    });

    it('should call the promise when forceReload is called', async () => {
      const callback = jest.fn();
      const promiseFn = async () => {
        callback();
      };

      const { result, waitForNextUpdate } = renderHook(() =>
        usePromise(promiseFn, {})
      );
      // initial data
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toStrictEqual(true);
      expect(result.current.error).toBeNull();

      // resolved data
      await waitForNextUpdate();
      expect(callback).toHaveBeenCalledTimes(1);

      act(() => {
        result.current.reload();
      });

      await waitForNextUpdate();
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe('component', () => {
    describe('react.FC usage', () => {
      type Params = { query: string };
      type LoaderPromise = (params: Params) => Promise<string>;
      type Props = {
        asyncFn: LoaderPromise;
        params: Params;
      };
      const MyComp: FC<Props> = ({ asyncFn, params }) => {
        const { data } = usePromise(asyncFn, params);
        return <div data-testid={'content'}>{data}</div>;
      };

      it('should conditionally call the promise based on deps changes', async () => {
        // Arrange
        const promise = Promise.resolve();
        const handleLoading = jest.fn(() => promise);
        const loadData = async (deps: Params) => {
          await handleLoading();
          return deps.query;
        };

        // Act
        const { rerender } = render(
          <MyComp asyncFn={loadData} params={{ query: 'query1' }} />
        );
        await act(() => promise);

        // Assert
        expect(screen.getByTestId('content').textContent).toBe('query1');
        expect(handleLoading).toHaveBeenCalledTimes(1);

        // 1. Promise should be called on deps changes
        rerender(<MyComp asyncFn={loadData} params={{ query: 'query2' }} />);
        await act(() => promise);
        expect(screen.getByTestId('content').textContent).toBe('query2');
        expect(handleLoading).toHaveBeenCalledTimes(2);

        // 2. Promise should not be called if deps have not changed
        rerender(<MyComp asyncFn={loadData} params={{ query: 'query2' }} />);
        await act(() => promise);
        expect(screen.getByTestId('content').textContent).toBe('query2');
        expect(handleLoading).toHaveBeenCalledTimes(2);
      });

      it('should call the promise if changed', async () => {
        // Arrange
        const promise = Promise.resolve();
        const handleLoading1 = jest.fn(() => promise);
        const handleLoading2 = jest.fn(() => promise);
        const loadData1 = async (deps: Params) => {
          await handleLoading1();
          return deps.query;
        };
        const loadData2 = async (deps: Params) => {
          await handleLoading2();
          return deps.query;
        };

        // Act & Assert
        const { rerender } = render(
          <MyComp asyncFn={loadData1} params={{ query: 'q' }} />
        );
        await act(() => promise);
        expect(handleLoading1).toHaveBeenCalledTimes(1);
        expect(handleLoading2).toHaveBeenCalledTimes(0);

        rerender(<MyComp asyncFn={loadData2} params={{ query: 'q' }} />);
        await act(() => promise);
        expect(handleLoading1).toHaveBeenCalledTimes(1);
        expect(handleLoading2).toHaveBeenCalledTimes(1);

        rerender(<MyComp asyncFn={loadData1} params={{ query: 'q' }} />);
        await act(() => promise);
        expect(handleLoading1).toHaveBeenCalledTimes(2);
        expect(handleLoading2).toHaveBeenCalledTimes(1);
      });
    });
  });
});
