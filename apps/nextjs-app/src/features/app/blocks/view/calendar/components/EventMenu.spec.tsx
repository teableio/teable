import type * as OpenApi from '@teable/openapi';
import type * as SdkHooks from '@teable/sdk/hooks';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventMenuStore } from '../hooks';
import { EventMenu } from './EventMenu';

const chat = vi.hoisted(() => ({ enabled: true, addToChat: vi.fn() }));
const dup = vi.hoisted(() => ({
  duplicate: vi.fn(),
  toast: { loading: vi.fn(() => 'toastId'), success: vi.fn(), dismiss: vi.fn() },
}));

// The raw endpoint and the mutation hook both resolve through `dup.duplicate`, so
// the duplicate tests check what the user sees, not which transport the menu picks.
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  duplicateRecord: (tableId: string, recordId: string, order: unknown) =>
    dup.duplicate({ tableId, recordId, order }),
}));
vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useTableId: () => 'tblTest',
  useView: () => ({ id: 'viwTest' }),
  useRecordOperations: () => ({ duplicateRecord: dup.duplicate }),
}));
vi.mock('@teable/ui-lib/shadcn/ui/sonner', () => ({ toast: dup.toast }));
vi.mock('../../hooks/useAddToChat', () => ({
  useAddToChat: () => ({ chatEnabled: chat.enabled, addToChat: chat.addToChat }),
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const eventMenu = {
  eventId: 'recEvent',
  permission: {
    eventCreatable: true,
    eventResizable: false,
    eventDeletable: true,
    eventDraggable: false,
  },
  position: { x: 10, y: 20 },
};

describe('calendar event add to chat', () => {
  beforeEach(() => {
    chat.enabled = true;
    chat.addToChat.mockClear();
  });

  afterEach(() => {
    useEventMenuStore.setState({ eventMenu: undefined });
  });

  it('shows the event menu entry and references the clicked event', () => {
    useEventMenuStore.setState({ eventMenu });

    render(<EventMenu />);
    fireEvent.click(screen.getByText('table:menu.addToChat'));

    expect(chat.addToChat).toHaveBeenCalledWith('recEvent');
  });

  it('hides the entry when AI chat is unavailable', () => {
    chat.enabled = false;
    useEventMenuStore.setState({ eventMenu });

    render(<EventMenu />);

    expect(screen.queryByText('table:menu.addToChat')).toBeNull();
  });
});

// T6206: the menu closes on click, so the copy must stay visible as pending until
// the API answers instead of looking done before the record exists.
describe('calendar event duplicate', () => {
  beforeEach(() => {
    dup.duplicate.mockReset();
    Object.values(dup.toast).forEach((fn) => fn.mockClear());
  });

  afterEach(() => {
    useEventMenuStore.setState({ eventMenu: undefined });
  });

  it('shows a pending state until the API answers, then reports success', async () => {
    let resolveDuplicate: () => void = () => undefined;
    dup.duplicate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDuplicate = resolve;
        })
    );
    useEventMenuStore.setState({ eventMenu });

    render(<EventMenu />);
    fireEvent.click(screen.getByText('sdk:expandRecord.duplicateRecord'));

    expect(dup.duplicate).toHaveBeenCalledWith({
      tableId: 'tblTest',
      recordId: 'recEvent',
      order: { viewId: 'viwTest', anchorId: 'recEvent', position: 'after' },
    });
    expect(dup.toast.loading).toHaveBeenCalledTimes(1);
    expect(dup.toast.success).not.toHaveBeenCalled();

    resolveDuplicate();
    await waitFor(() =>
      expect(dup.toast.success).toHaveBeenCalledWith(expect.any(String), { id: 'toastId' })
    );
  });

  it('clears the pending state on failure without reporting success', async () => {
    dup.duplicate.mockRejectedValue(new Error('boom'));
    useEventMenuStore.setState({ eventMenu });

    render(<EventMenu />);
    fireEvent.click(screen.getByText('sdk:expandRecord.duplicateRecord'));

    expect(dup.toast.loading).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dup.toast.dismiss).toHaveBeenCalledWith('toastId'));
    expect(dup.toast.success).not.toHaveBeenCalled();
  });
});
