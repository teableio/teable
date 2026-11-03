import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@teable/ui-lib/shadcn';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BaseSidebarHeaderLeft } from './BaseSidebarHeaderLeft';

vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBaseList: vi.fn().mockResolvedValue({ data: [] }),
  getSharedBase: vi.fn().mockResolvedValue({ data: [] }),
  getSpaceById: vi.fn().mockResolvedValue({ data: {} }),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const mockBase = vi.hoisted(() => ({
  current: {
    id: 'bseTest',
    name: 'Test base',
    spaceId: 'spcTest',
    role: 'owner',
    collaboratorType: 'base',
  },
}));
const mockInstances = vi.hoisted(() => ({ count: 0 }));
vi.mock('@teable/sdk/hooks', () => ({
  useBase: () => mockBase.current,
  useContentDir: () => 'ltr',
}));
vi.mock('@teable/sdk/hooks/use-is-readonly-preview', () => ({ useIsReadOnlyPreview: () => false }));
vi.mock('@/features/app/hooks/useIsCloud', () => ({ useIsCloud: () => false }));
vi.mock('./BaseNodeShareIndicator', () => ({ useSharedNodeIds: () => ({ isBaseShared: false }) }));
vi.mock('./BaseShareDialog', () => ({ BaseShareDialog: () => null }));
vi.mock('@/features/app/blocks/space/DataDbBadge', () => ({ DataDbBadge: () => null }));
// Stand-in with the real dialog primitives, supporting both trigger and controlled usage.
// Each mounted instance gets an id so tests can tell a remount (fresh form state) apart.
const MockPublishBaseDialog = ({
  children,
  open,
  onOpenChange,
}: {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => {
  const [instance] = useState(() => ++mockInstances.count);
  return (
    <>
      <span data-testid="publish-instance">{instance}</span>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
        <DialogContent>
          <DialogTitle>publish dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
};
vi.mock('../../table/table-header/publish-base/PublishBaseDialog', () => ({
  PublishBaseDialog: (props: Parameters<typeof MockPublishBaseDialog>[0]) => (
    <MockPublishBaseDialog {...props} />
  ),
}));

const renderHeader = () => {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <BaseSidebarHeaderLeft />
    </QueryClientProvider>
  );
  const rerender = () =>
    view.rerender(
      <QueryClientProvider client={client}>
        <BaseSidebarHeaderLeft />
      </QueryClientProvider>
    );
  return { rerender };
};

const openPublishDialog = async (baseName: string) => {
  fireEvent.pointerDown(screen.getByText(baseName), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByText('space:publishBase.publishToCommunity'));
  expect(await screen.findByText('publish dialog')).toBeTruthy();
};

describe('BaseSidebarHeaderLeft publish entry', () => {
  it('keeps the publish dialog open when the window blurs (cover file picker) T7195', async () => {
    renderHeader();
    await openPublishDialog('Test base');

    // Opening the OS file picker for the cover blurs the browser window.
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(screen.queryByText('publish dialog')).toBeTruthy();
  });

  it('mounts the publish dialog on demand and remounts it for another base', async () => {
    const { rerender } = renderHeader();
    // Not mounted until used, so the template query does not run on every base load.
    expect(screen.queryByTestId('publish-instance')).toBeNull();

    await openPublishDialog('Test base');
    const firstInstance = screen.getByTestId('publish-instance').textContent;
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    mockBase.current = { ...mockBase.current, id: 'bseOther', name: 'Other base' };
    rerender();

    // A fresh instance means title, description and nodes from the previous base are gone.
    expect(screen.getByTestId('publish-instance').textContent).not.toBe(firstInstance);
  });
});
