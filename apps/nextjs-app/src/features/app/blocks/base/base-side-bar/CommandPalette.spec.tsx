import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionContext } from '@teable/sdk/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaletteSurface } from './CommandPalette';
import type { PaletteEntry } from './palette-types';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/router', () => ({
  useRouter: () => ({ push, asPath: '/base/bseFixture', query: {} }),
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const view: PaletteEntry = {
  id: 'view',
  label: 'Follow-up board',
  description: 'Customers',
  href: '/base/bseFixture/table/tblCustomers/viwBoard',
};
const resources: PaletteEntry[] = [
  view,
  { id: 'customers', label: 'Customers', href: '/base/bseFixture/table/tblCustomers' },
];

const Harness = ({
  commands = [],
  onAskAI,
}: {
  commands?: PaletteEntry[];
  onAskAI?: (text: string, files?: File[]) => void;
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen((previous) => !previous)}>
        Open palette
      </button>
      <PaletteSurface
        open={open}
        onOpenChange={setOpen}
        resources={resources}
        recent={[view]}
        commands={commands}
        onAskAI={onAskAI}
        triggerRef={triggerRef}
        projectName="Project"
        projectIcon="🧪"
      />
    </>
  );
};
const setup = (commands: PaletteEntry[] = [], onAskAI?: (text: string, files?: File[]) => void) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
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
        <Harness commands={commands} onAskAI={onAskAI} />
      </SessionContext.Provider>
    </QueryClientProvider>
  );
  return userEvent.setup();
};

beforeEach(() => {
  push.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

describe('palette keyboard transitions', () => {
  it('searches resources and commands together, but excludes resources in command mode', async () => {
    const user = setup([{ id: 'create', label: 'Create customers table', execute: vi.fn() }]);
    await user.click(screen.getByText('Open palette'));
    await user.type(screen.getByRole('combobox'), 'customers');
    expect(screen.getByRole('option', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Create customers table' })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), '>customers');
    expect(screen.queryByRole('option', { name: 'Customers' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Create customers table' })).toBeInTheDocument();
  });

  it('opens the exact recent view using Enter rather than the table default', async () => {
    const user = setup();
    await user.click(screen.getByText('Open palette'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(push).toHaveBeenCalledWith(view.href));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not submit during IME confirmation and submits once after composition ends', async () => {
    const ask = vi.fn();
    const user = setup([], ask);
    await user.click(screen.getByText('Open palette'));
    const input = screen.getByRole('combobox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '分析本月回款' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.compositionEnd(input, { data: '分析本月回款' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(ask).toHaveBeenCalledExactlyOnceWith('分析本月回款'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns from appearance before closing and restores trigger focus', async () => {
    const user = setup();
    await user.click(screen.getByText('Open palette'));
    await user.type(screen.getByRole('combobox'), '>');
    await user.click(screen.getByRole('option', { name: 'commandPalette.appearance' }));
    expect(
      within(screen.getByRole('listbox')).getByRole('option', { name: 'settings.setting.dark' })
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option', { name: 'settings.setting.dark' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox')).toHaveValue('');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Open palette')).toHaveFocus();
    await user.click(screen.getByText('Open palette'));
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('activates a keyboard-focused footer control without dispatching the selected result', async () => {
    const ask = vi.fn();
    const user = setup([], ask);
    await user.click(screen.getByText('Open palette'));
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'commandPalette.shortcuts' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('commandPalette.toggle')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps settings discoverable in command mode without putting them in the empty state', async () => {
    const user = setup();
    await user.click(screen.getByText('Open palette'));
    expect(screen.queryByRole('option', { name: 'settings.allSetting' })).toBeNull();
    await user.type(screen.getByRole('combobox'), '>');
    expect(screen.getByRole('option', { name: 'settings.allSetting' })).toBeInTheDocument();
  });

  it('keeps unmatched short text available to AI without sending while typing', async () => {
    const ask = vi.fn();
    const user = setup([], ask);
    await user.click(screen.getByText('Open palette'));
    await user.type(screen.getByRole('combobox'), 'zk99');
    expect(ask).not.toHaveBeenCalled();
    await user.keyboard('{Tab}');
    await waitFor(() => expect(ask).toHaveBeenCalledExactlyOnceWith('zk99'));
  });

  it('opens a selected resource in a new tab for a modifier Enter', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = setup();
    await user.click(screen.getByText('Open palette'));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', metaKey: true });
    expect(open).toHaveBeenCalledWith(view.href, '_blank', 'noopener,noreferrer');
    expect(push).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

describe('palette attachments and project context', () => {
  it('hands pasted files to Cuppy with the typed text instead of searching', async () => {
    const ask = vi.fn();
    const user = setup([], ask);
    await user.click(screen.getByText('Open palette'));
    const input = screen.getByRole('combobox');
    await user.type(input, '看看这张图');
    const file = new File(['image'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(input, { clipboardData: { files: [file] } });
    await waitFor(() => expect(ask).toHaveBeenCalledWith('看看这张图', [file]));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
