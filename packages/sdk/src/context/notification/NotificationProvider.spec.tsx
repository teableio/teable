import { EventEmitter } from 'events';
import { getUserNotificationChannel, sessionRevokedSignal } from '@teable/core';
import { act, cleanup, render } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationContext } from './NotificationContext';
import { NotificationProvider } from './NotificationProvider';

const userId = 'usrTarget';
const presences = new Map<string, ReturnType<typeof createPresence>>();
const connection = {
  getPresence: (channel: string) => {
    let presence = presences.get(channel);
    if (!presence) {
      presence = createPresence();
      presences.set(channel, presence);
    }
    return presence;
  },
};

function createPresence() {
  return Object.assign(new EventEmitter(), {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    destroy: vi.fn(),
  });
}

const redirect = vi.fn();
vi.mock('../app/queryClient', () => ({ redirectToUnauthenticatedAuth: () => redirect() }));
vi.mock('../../hooks/use-connection', () => ({ useConnection: () => ({ connection }) }));
vi.mock('../../hooks', () => ({ useSession: () => ({ user: { id: userId } }) }));

const Probe = () => {
  const notification = useContext(NotificationContext);
  return <span data-testid="unread">{notification?.unreadCount ?? 'none'}</span>;
};

const notification = {
  notification: { id: 'not1', message: 'hi' },
  unreadCount: 3,
};

describe('NotificationProvider', () => {
  afterEach(() => {
    cleanup();
    presences.clear();
    redirect.mockClear();
  });

  it('hands a notification on the user channel to the context', async () => {
    const { findByTestId } = render(
      <NotificationProvider>
        <Probe />
      </NotificationProvider>
    );
    await findByTestId('unread');
    const presence = presences.get(getUserNotificationChannel(userId))!;
    expect(presence.subscribe).toHaveBeenCalled();

    act(() => presence.emit('receive', 'not1', notification));

    expect((await findByTestId('unread')).textContent).toBe('3');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('leaves for sign-in on the session-revoked signal instead of showing it', async () => {
    const { findByTestId } = render(
      <NotificationProvider>
        <Probe />
      </NotificationProvider>
    );
    await findByTestId('unread');
    const presence = presences.get(getUserNotificationChannel(userId))!;

    act(() => presence.emit('receive', 'x', sessionRevokedSignal()));

    expect(redirect).toHaveBeenCalledTimes(1);
    expect((await findByTestId('unread')).textContent).toBe('none');
  });
});
