import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBaseNodeCrud } from './useBaseNodeCrud';

const { deleteBaseNode, context } = vi.hoisted(() => ({
  deleteBaseNode: vi.fn(),
  context: { base: { spaceId: 'spcA' } as { spaceId: string } | undefined },
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteBaseNode,
}));
vi.mock('@teable/sdk/hooks', () => ({
  useBaseId: () => 'bseA',
  useBase: () => context.base,
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./useBaseNodeContext', () => ({
  useBaseNodeContext: () => ({ treeItems: {}, invalidateMenu: vi.fn() }),
}));

const renderCrud = () => {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const { result } = renderHook(() => useBaseNodeCrud(), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { deleteNode: result.current.deleteNode, invalidateQueries };
};

describe('useBaseNodeCrud delete', () => {
  const spaceProjects = { queryKey: ReactQueryKeys.baseList('spcA') };

  beforeEach(() => {
    context.base = { spaceId: 'spcA' };
  });

  it("refreshes the space's project lists, which show what is in each project", async () => {
    deleteBaseNode.mockResolvedValue({ data: undefined });
    const { deleteNode, invalidateQueries } = renderCrud();

    await deleteNode('bnodeA');

    expect(invalidateQueries).toHaveBeenCalledWith(spaceProjects);
  });

  it('refreshes them after a delete that failed part way too', async () => {
    deleteBaseNode.mockRejectedValue(new Error('stopped part way'));
    const { deleteNode, invalidateQueries } = renderCrud();

    await expect(deleteNode('bnodeA')).rejects.toThrow('stopped part way');

    expect(invalidateQueries).toHaveBeenCalledWith(spaceProjects);
  });

  it('deletes where no base is provided, as on the space page', async () => {
    context.base = undefined;
    deleteBaseNode.mockResolvedValue({ data: undefined });
    const { deleteNode, invalidateQueries } = renderCrud();

    await deleteNode('bnodeA');

    expect(invalidateQueries).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: expect.arrayContaining(['base-list']) })
    );
  });
});
