import type * as SdkHooks from '@teable/sdk/hooks';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventMenuStore } from '../hooks';
import { EventMenu } from './EventMenu';

const chat = vi.hoisted(() => ({ enabled: true, addToChat: vi.fn() }));

vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useTableId: () => 'tblTest',
  useView: () => ({ id: 'viwTest' }),
}));
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
