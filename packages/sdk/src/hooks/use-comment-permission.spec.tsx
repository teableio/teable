/* eslint-disable @typescript-eslint/naming-convention */
import { renderHook } from '@testing-library/react';
import type { ContextType, ReactNode } from 'react';
import { vi } from 'vitest';
import { AppContext } from '../context/app/AppContext';
import { useCommentPermission } from './use-comment-permission';
import { useTablePermission } from './use-table-permission';

vi.mock('./use-table-permission', () => ({
  useTablePermission: vi.fn(),
}));

const mockedUseTablePermission = vi.mocked(useTablePermission);

const setPermission = (actions: Record<string, boolean>) => {
  mockedUseTablePermission.mockReturnValue(
    actions as unknown as ReturnType<typeof useTablePermission>
  );
};

const shareWrapper = (shareId?: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppContext.Provider value={{ shareId } as unknown as ContextType<typeof AppContext>}>
      {children}
    </AppContext.Provider>
  );
  return wrapper;
};

describe('useCommentPermission', () => {
  it('lets a record reader see comments without letting them write', () => {
    setPermission({ 'record|read': true, 'record|comment': false });

    const { result } = renderHook(() => useCommentPermission(), { wrapper: shareWrapper() });

    expect(result.current).toEqual({ commentReadable: true, commentWritable: false });
  });

  it('grants both when the role also has record|comment', () => {
    setPermission({ 'record|read': true, 'record|comment': true });

    const { result } = renderHook(() => useCommentPermission(), { wrapper: shareWrapper() });

    expect(result.current).toEqual({ commentReadable: true, commentWritable: true });
  });

  it('denies both without record|read', () => {
    setPermission({ 'record|read': false, 'record|comment': true });

    const { result } = renderHook(() => useCommentPermission(), { wrapper: shareWrapper() });

    expect(result.current).toEqual({ commentReadable: false, commentWritable: false });
  });

  it('offers nothing behind a share link — shared view or shared base — whatever the permissions say', () => {
    setPermission({ 'record|read': true, 'record|comment': true });

    const { result } = renderHook(() => useCommentPermission(), {
      wrapper: shareWrapper('shrTest'),
    });

    expect(result.current).toEqual({ commentReadable: false, commentWritable: false });
  });
});
