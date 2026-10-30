/* eslint-disable @typescript-eslint/naming-convention */
import { renderHook } from '@testing-library/react';
import type { ContextType, ReactNode } from 'react';
import { vi } from 'vitest';
import { AppContext } from '../context/app/AppContext';
import { useBasePermission } from './use-base-permission';
import { useCommentPermission } from './use-comment-permission';
import { useTablePermission } from './use-table-permission';

vi.mock('./use-table-permission', () => ({
  useTablePermission: vi.fn(),
}));
vi.mock('./use-base-permission', () => ({
  useBasePermission: vi.fn(),
}));

const mockedUseTablePermission = vi.mocked(useTablePermission);
const mockedUseBasePermission = vi.mocked(useBasePermission);

// table|update is a base-role action: it goes to the base permission, the rest to the table
const setPermission = ({ 'table|update': tableUpdate, ...actions }: Record<string, boolean>) => {
  mockedUseTablePermission.mockReturnValue(
    actions as unknown as ReturnType<typeof useTablePermission>
  );
  mockedUseBasePermission.mockReturnValue({
    'table|update': Boolean(tableUpdate),
  } as unknown as ReturnType<typeof useBasePermission>);
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

    expect(result.current).toEqual({
      commentReadable: true,
      commentWritable: false,
      commentManageable: false,
    });
  });

  it('grants both when the role also has record|comment', () => {
    setPermission({ 'record|read': true, 'record|comment': true });

    const { result } = renderHook(() => useCommentPermission(), { wrapper: shareWrapper() });

    expect(result.current).toEqual({
      commentReadable: true,
      commentWritable: true,
      commentManageable: false,
    });
  });

  it('denies both without record|read', () => {
    setPermission({ 'record|read': false, 'record|comment': true });

    const { result } = renderHook(() => useCommentPermission(), { wrapper: shareWrapper() });

    expect(result.current).toEqual({
      commentReadable: false,
      commentWritable: false,
      commentManageable: false,
    });
  });

  it('offers nothing behind a share link — shared view or shared base — whatever the permissions say', () => {
    setPermission({ 'record|read': true, 'record|comment': true, 'table|update': true });

    const { result } = renderHook(() => useCommentPermission(), {
      wrapper: shareWrapper('shrTest'),
    });

    expect(result.current).toEqual({
      commentReadable: false,
      commentWritable: false,
      commentManageable: false,
    });
  });

  it('lets a base creator manage (delete) anyone’s comment through the base role’s table|update', () => {
    setPermission({ 'record|read': true, 'record|comment': true, 'table|update': true });

    const { result } = renderHook(() => useCommentPermission(), { wrapper: shareWrapper() });

    expect(result.current).toEqual({
      commentReadable: true,
      commentWritable: true,
      commentManageable: true,
    });
  });

  it('does not let an editor manage others’ comments', () => {
    setPermission({ 'record|read': true, 'record|comment': true, 'table|update': false });

    const { result } = renderHook(() => useCommentPermission(), { wrapper: shareWrapper() });

    expect(result.current.commentManageable).toBe(false);
  });

  it('ignores a matrix-granted table|update when the base role lacks it', () => {
    mockedUseTablePermission.mockReturnValue({
      'record|read': true,
      'record|comment': true,
      'table|update': true,
    } as unknown as ReturnType<typeof useTablePermission>);
    mockedUseBasePermission.mockReturnValue({
      'table|update': false,
    } as unknown as ReturnType<typeof useBasePermission>);

    const { result } = renderHook(() => useCommentPermission(), { wrapper: shareWrapper() });

    expect(result.current.commentManageable).toBe(false);
  });
});
