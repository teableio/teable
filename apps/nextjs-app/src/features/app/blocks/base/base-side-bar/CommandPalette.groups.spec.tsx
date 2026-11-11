import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionContext } from '@teable/sdk/context';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaletteSurface } from './CommandPalette';
import type { PaletteEntry, PaletteResultGroup, UsePaletteExtraResults } from './palette-types';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/router', () => ({
  useRouter: () => ({ push, asPath: '/base/bseFixture', query: {} }),
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options?.scope ? `${key}:${options.scope}` : key,
  }),
}));

const tables = (count: number): PaletteEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `table:${index}`,
    label: `Refund table ${index}`,
    href: `/base/bseFixture/table/tbl${index}`,
    category: 'table',
  }));

const dashboards = (count: number): PaletteEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `dashboard:${index}`,
    label: `Refund board ${index}`,
    href: `/base/bseFixture/dashboard/dsh${index}`,
    category: 'dashboard',
  }));

const chats = (count: number): PaletteEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `chat:${index}`,
    label: `Refund chat ${index}`,
    href: `/base/bseFixture/chat/cht${index}?message=msg${index}&q=refund`,
    snippet: { text: `the refund flow ${index}`, matchOffset: 4, matchLength: 6 },
    actionLabel: 'Go to message',
    analytics: { kind: 'chat', matched: 'message' },
  }));

const chatGroup = (entries: PaletteEntry[], more: Partial<PaletteResultGroup> = {}) => ({
  id: 'chat',
  heading: 'Chats',
  entries,
  scopeEntries: [
    { id: 'chat:0', label: 'Refund chat 0', href: '/base/bseFixture/chat/cht0' },
    {
      id: 'chat:0:msg7',
      label: 'an older refund',
      variant: 'sub' as const,
      snippet: { text: 'an older refund', matchOffset: 9, matchLength: 6 },
      href: '/base/bseFixture/chat/cht0?message=msg7&q=refund',
      actionLabel: 'Go to message',
    },
  ],
  isLoading: false,
  error: false,
  retry: vi.fn(),
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  ...more,
});

const setup = (
  resources: PaletteEntry[],
  useExtraResults: UsePaletteExtraResults,
  categories = ['table']
) => {
  const Harness = () => {
    const [open, setOpen] = useState(true);
    return (
      <PaletteSurface
        open={open}
        onOpenChange={setOpen}
        resources={resources}
        recent={[]}
        commands={[]}
        categories={categories}
        spaceId="spcFixture"
        useExtraResults={useExtraResults}
      />
    );
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionContext.Provider
        value={{
          user: {
            id: 'usrFixture',
            name: 'Fixture',
            email: 'fixture@example.com',
            notifyMeta: {},
            hasPassword: true,
          },
          refresh: vi.fn(),
          refreshAvatar: vi.fn(),
        }}
      >
        <Harness />
      </SessionContext.Provider>
    </QueryClientProvider>
  );
  return userEvent.setup();
};

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent);

beforeEach(() => {
  push.mockReset().mockResolvedValue(true);
  window.posthog = { capture: vi.fn() } as never;
});
afterEach(cleanup);

describe('palette with an edition group', () => {
  it('caps both groups in the all scope and leads each into its own scope', async () => {
    const extra = vi.fn<UsePaletteExtraResults>((query) =>
      query ? chatGroup(chats(7)) : undefined
    );
    const user = setup(tables(7), extra);
    await user.type(screen.getByRole('combobox'), 'refund');

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'commandPalette.all',
      'noun.table',
      'Chats',
    ]);
    const names = optionNames();
    expect(names.filter((name) => name?.startsWith('Refund table'))).toHaveLength(5);
    expect(names.filter((name) => name?.startsWith('Refund chat'))).toHaveLength(5);
    expect(names).toContain('commandPalette.searchMore:noun.table');
    expect(extra).toHaveBeenLastCalledWith('refund', 'spcFixture');

    await user.click(screen.getByRole('option', { name: 'commandPalette.searchMore:Chats' }));
    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'true');
    expect(optionNames()).toEqual(['Refund chat 0', 'an older refund']);

    await user.keyboard('{Escape}');
    expect(screen.getByRole('tab', { name: 'commandPalette.all' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers a tab per kind whose feature is on, matches or not', async () => {
    const app: PaletteEntry = { id: 'appRefund', label: 'Refund app', category: 'app' };
    const user = setup(
      [...tables(2), ...dashboards(1), app],
      (query) => (query ? chatGroup(chats(1)) : undefined),
      ['table', 'dashboard', 'workflow']
    );
    await user.type(screen.getByRole('combobox'), 'refund');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'commandPalette.all',
      'noun.table',
      'noun.dashboard',
      'noun.automation',
      'Chats',
    ]);
    expect(screen.getByRole('group', { name: 'noun.dashboard' })).toHaveTextContent(
      'Refund board 0'
    );
    // Apps are off here: no tab, and their rows stay out.
    expect(screen.queryByRole('option', { name: /Refund app/ })).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'noun.automation' }));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('commandPalette.noResults');

    await user.click(screen.getByRole('tab', { name: 'noun.dashboard' }));
    expect(optionNames()).toEqual(['Refund board 0']);
    await user.type(screen.getByRole('combobox'), ' table');
    expect(screen.getByRole('tab', { name: 'noun.dashboard' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('counts a match of a kind that is off as no match', async () => {
    const app: PaletteEntry = { id: 'appRefund', label: 'Refund app', category: 'app' };
    const user = setup([app], (query) => (query ? chatGroup([]) : undefined));
    await user.type(screen.getByRole('combobox'), 'refund app');
    expect(screen.getByRole('status')).toHaveTextContent('commandPalette.noResults');
  });

  it('lists one group in full when the other has nothing', async () => {
    const user = setup([], (query) => (query ? chatGroup(chats(7)) : undefined));
    await user.type(screen.getByRole('combobox'), 'refund');
    expect(optionNames().filter((name) => name?.startsWith('Refund chat'))).toHaveLength(7);
    expect(screen.queryByText('commandPalette.noResults')).toBeNull();
  });

  it('leads on to older chats from a page the scan limit left empty', async () => {
    const fetchNextPage = vi.fn();
    const scanLimited = { hasNextPage: true, olderOnRequest: true, fetchNextPage };
    const user = setup([], (query) => (query ? chatGroup([], scanLimited) : undefined));
    await user.type(screen.getByRole('combobox'), 'refund');
    await user.click(screen.getByRole('button', { name: 'commandPalette.loadOlder' }));
    expect(fetchNextPage).toHaveBeenCalled();

    cleanup();
    const beside = setup(tables(1), (query) => (query ? chatGroup([], scanLimited) : undefined));
    await beside.type(screen.getByRole('combobox'), 'refund');
    expect(optionNames()).toContain('commandPalette.searchMore:Chats');
  });

  it('opens a matching message and reports it as a chat hit', async () => {
    const user = setup(tables(1), (query) => (query ? chatGroup(chats(1)) : undefined));
    await user.type(screen.getByRole('combobox'), 'refund');
    await user.click(screen.getByRole('option', { name: /Refund chat 0/ }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/base/bseFixture/chat/cht0?message=msg0&q=refund')
    );
    expect(window.posthog?.capture).toHaveBeenCalledWith(
      'command_palette_select',
      expect.objectContaining({ kind: 'chat', matched: 'message' })
    );
  });

  it('keeps a failed group apart from the resources', async () => {
    const retry = vi.fn();
    const user = setup(tables(2), (query) =>
      query ? chatGroup([], { error: true, retry }) : undefined
    );
    await user.type(screen.getByRole('combobox'), 'refund');
    expect(optionNames()).toEqual(['Refund table 0', 'Refund table 1']);
    await user.click(screen.getByRole('button', { name: 'commandPalette.retry' }));
    expect(retry).toHaveBeenCalled();
  });

  it('counts the group in the search event', async () => {
    const user = setup(tables(1), (query) => (query ? chatGroup(chats(3)) : undefined));
    await user.type(screen.getByRole('combobox'), 'refund');
    await waitFor(() =>
      expect(window.posthog?.capture).toHaveBeenCalledWith(
        'command_palette_search',
        expect.objectContaining({ chat_results: 3, zero_result: false })
      )
    );
  });
});
