import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { SessionContext } from '@teable/sdk/context';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextTestStubProvider } from '../../../../../../config/tests/I18nextTestStubProvider';
import { CommandPalette } from './CommandPalette';

const { getUserLastVisitListBase, getBaseAll, spaceSearch, getPublicSetting, getAIDisableActions } =
  vi.hoisted(() => ({
    getUserLastVisitListBase: vi.fn(),
    getBaseAll: vi.fn(),
    spaceSearch: vi.fn(),
    getPublicSetting: vi.fn(),
    getAIDisableActions: vi.fn(),
  }));

vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getUserLastVisitListBase,
  getBaseAll,
  spaceSearch,
  getPublicSetting,
  getAIDisableActions,
}));

const setup = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router: NextRouter = {
    basePath: '',
    pathname: '/space/[spaceId]',
    route: '/space/[spaceId]',
    query: { spaceId: 'spcCurrent' },
    asPath: '/space/spcCurrent',
    push: vi.fn().mockResolvedValue(true),
    replace: vi.fn().mockResolvedValue(true),
    reload: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
    beforePopState: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    isFallback: false,
    isReady: true,
    isPreview: false,
    isLocaleDomain: false,
  };
  const session = {
    user: {
      id: 'usrOne',
      name: 'One',
      email: 'one@example.com',
      notifyMeta: {},
      hasPassword: true,
    },
    refresh: vi.fn(),
    refreshAvatar: vi.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RouterContext.Provider value={router}>
        <I18nextTestStubProvider>
          <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
        </I18nextTestStubProvider>
      </RouterContext.Provider>
    </QueryClientProvider>
  );
  return { wrapper, router };
};

describe('CommandPalette space recents', () => {
  beforeEach(() => {
    getUserLastVisitListBase.mockReset().mockResolvedValue({
      data: {
        total: 3,
        list: [
          {
            resourceType: 'base',
            resourceId: 'bseMoved',
            lastVisitTime: '2026-10-27T09:00:00.000Z',
            resource: {
              id: 'bseMoved',
              name: 'Old project name',
              icon: null,
              role: 'owner',
              spaceId: 'spcFormer',
              createdBy: 'usrOne',
            },
          },
          {
            resourceType: 'base',
            resourceId: 'bseSecond',
            lastVisitTime: '2026-10-27T08:00:00.000Z',
            resource: {
              id: 'bseSecond',
              name: 'Stale second name',
              icon: null,
              role: 'owner',
              spaceId: 'spcCurrent',
              createdBy: 'usrOne',
            },
          },
          {
            resourceType: 'base',
            resourceId: 'bseInaccessible',
            lastVisitTime: '2026-10-27T10:00:00.000Z',
            resource: {
              id: 'bseInaccessible',
              name: 'Inaccessible project',
              icon: null,
              role: 'owner',
              spaceId: 'spcCurrent',
              createdBy: 'usrOne',
            },
          },
        ],
      },
    });
    getBaseAll.mockReset().mockResolvedValue({
      data: [
        {
          id: 'bseSecond',
          name: 'Current second name',
          icon: null,
          role: 'owner',
          spaceId: 'spcCurrent',
          createdBy: 'usrOne',
        },
        {
          id: 'bseMoved',
          name: 'Current project name',
          icon: null,
          role: 'owner',
          spaceId: 'spcCurrent',
          createdBy: 'usrOne',
        },
        {
          id: 'bseOtherSpace',
          name: 'Other space project',
          icon: null,
          role: 'owner',
          spaceId: 'spcOther',
          createdBy: 'usrOne',
        },
      ],
    });
    spaceSearch.mockReset().mockResolvedValue({ data: { list: [], nextCursor: null } });
    getPublicSetting.mockReset().mockResolvedValue({ data: {} });
    getAIDisableActions.mockReset().mockResolvedValue({ data: { disableActions: [] } });
  });
  afterEach(cleanup);

  it('intersects visit history with current accessible bases and preserves visit order', async () => {
    const user = userEvent.setup();
    const { wrapper, router } = setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} spaceId="spcCurrent" />, { wrapper });

    const currentProject = await screen.findByText('Current project name');
    const secondProject = screen.getByText('Current second name');
    const currentOption = currentProject.closest('[role="option"]');
    const secondOption = secondProject.closest('[role="option"]');
    expect(currentOption).not.toBeNull();
    expect(secondOption).not.toBeNull();
    expect(
      currentProject.compareDocumentPosition(secondProject) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText('Old project name')).toBeNull();
    expect(screen.queryByText('Inaccessible project')).toBeNull();
    expect(screen.queryByText('Other space project')).toBeNull();

    await user.click(currentOption!);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/base/bseMoved'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not fetch recent-base data while closed or without a space scope', () => {
    const { wrapper } = setup();
    render(
      <>
        <CommandPalette open={false} onOpenChange={vi.fn()} spaceId="spcCurrent" />
        <CommandPalette open onOpenChange={vi.fn()} />
      </>,
      { wrapper }
    );

    expect(getUserLastVisitListBase).not.toHaveBeenCalled();
    expect(getBaseAll).not.toHaveBeenCalled();
    expect(spaceSearch).not.toHaveBeenCalled();
  });
});
