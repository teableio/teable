import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { UserIntegrationProvider } from '@teable/openapi';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectIntegration } from './useConnectIntegration';
import { openConnectIntegration } from './utils';

vi.mock('./utils', () => ({ openConnectIntegration: vi.fn() }));

const listIntegrations = vi.hoisted(() => vi.fn());
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getUserIntegrationList: (...args: unknown[]) => listIntegrations(...args),
}));

const AIRTABLE = UserIntegrationProvider.Airtable;
const grants = (integrations: unknown[]) => ({ data: { integrations } });
const connected = [
  {
    id: 'usi1',
    provider: AIRTABLE,
    hasSecret: true,
    connectedTime: new Date('2026-01-01').toISOString(),
  },
];

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
};

/** A popup whose `closed` we can flip, like the user closing the OAuth window. */
const fakePopup = () => ({ closed: false, close: vi.fn() }) as unknown as Window;

describe('useConnectIntegration', () => {
  let popup: Window;

  beforeEach(() => {
    vi.useFakeTimers();
    popup = fakePopup();
    vi.mocked(openConnectIntegration).mockReturnValue(popup);
    listIntegrations.mockResolvedValue(grants([]));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const setup = () => {
    const onConnected = vi.fn();
    const onDismissed = vi.fn();
    const { result } = renderHook(() => useConnectIntegration({ onConnected, onDismissed }), {
      wrapper,
    });
    return { result, onConnected, onDismissed };
  };

  it('releases the connecting state when the popup is closed without authorizing', async () => {
    const { result, onDismissed } = setup();
    act(() => {
      result.current.connect(AIRTABLE);
    });
    expect(result.current.isConnecting).toBe(true);

    (popup as unknown as { closed: boolean }).closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(onDismissed).toHaveBeenCalledWith(AIRTABLE);
    expect(result.current.isConnecting).toBe(false);

    // ...and clicking connect again opens a fresh popup instead of being
    // swallowed by the in-flight guard.
    act(() => {
      result.current.connect(AIRTABLE);
    });
    expect(openConnectIntegration).toHaveBeenCalledTimes(2);
    expect(result.current.isConnecting).toBe(true);
    act(() => result.current.cancelConnect(AIRTABLE));
  });

  it('still reports success when a dismissed popup was only severed by COOP', async () => {
    const { result, onConnected, onDismissed } = setup();
    act(() => {
      result.current.connect(AIRTABLE);
    });
    // A COOP browsing-context swap makes a live popup read as closed.
    (popup as unknown as { closed: boolean }).closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onDismissed).toHaveBeenCalledTimes(1);

    // The user finishes the authorization in that still-open window.
    listIntegrations.mockResolvedValue(grants(connected));
    // The poll backs off to 6s once the popup looks gone, so 4s buys nothing...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(onConnected).not.toHaveBeenCalled();
    // ...but it is still listening, and the next tick picks the grant up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(onConnected).toHaveBeenCalledWith(AIRTABLE, 'usi1');
  });

  it('keeps a second click from starting a duplicate poll while the popup lives', () => {
    const { result } = setup();
    act(() => {
      result.current.connect(AIRTABLE);
      result.current.connect(AIRTABLE);
    });
    expect(openConnectIntegration).toHaveBeenCalledTimes(1);
    act(() => result.current.cancelConnect(AIRTABLE));
  });
});
