import { ShareViewContext } from '@teable/sdk/context';
import { syncCopy } from '@teable/sdk/utils';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useContextMenu } from './useContextMenu';

let baseId: string | undefined;

vi.mock('@teable/sdk/context', async () => {
  const { createContext } = await import('react');
  return { ShareViewContext: createContext({}) };
});

vi.mock('@teable/sdk/hooks', () => ({
  useBaseId: () => baseId,
  useTableId: () => 'tblA',
}));

vi.mock('@teable/sdk/utils', () => ({
  syncCopy: vi.fn(),
}));

vi.mock('@teable/ui-lib/shadcn/ui/sonner', () => ({
  toast: { success: vi.fn() },
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/x', query: {}, push: vi.fn() }),
}));

vi.mock('@/features/app/hooks/useEnv', () => ({
  useEnv: () => ({ publicOrigin: 'https://teable.io' }),
}));

const shareWrapper = ({ children }: { children: ReactNode }) => (
  <ShareViewContext.Provider value={{ shareId: 'shrA' } as never}>
    {children}
  </ShareViewContext.Provider>
);

describe('useContextMenu copyRecordUrl', () => {
  beforeEach(() => {
    vi.mocked(syncCopy).mockClear();
  });

  it('builds the workspace record link from baseId and tableId', async () => {
    baseId = 'bseA';

    const { result } = renderHook(() => useContextMenu());
    await act(() => result.current.copyRecordUrl('recA'));

    expect(syncCopy).toHaveBeenCalledWith('https://teable.io/base/bseA/table/tblA?recordId=recA');
  });

  it('builds the share record link in a share view, which has no baseId', async () => {
    // used to hit the baseId guard and silently copy nothing
    baseId = undefined;

    const { result } = renderHook(() => useContextMenu(), { wrapper: shareWrapper });
    await act(() => result.current.copyRecordUrl('recA'));

    expect(syncCopy).toHaveBeenCalledWith('https://teable.io/share/shrA/view?recordId=recA');
  });

  it('copies nothing when there is neither a share nor a base to address', async () => {
    baseId = undefined;

    const { result } = renderHook(() => useContextMenu());
    await act(() => result.current.copyRecordUrl('recA'));

    expect(syncCopy).not.toHaveBeenCalled();
  });
});
