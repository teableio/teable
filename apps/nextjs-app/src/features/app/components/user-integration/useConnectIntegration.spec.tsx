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

/** jsdom has no BroadcastChannel; this one delivers what the callback page would post. */
const channels: FakeChannel[] = [];
class FakeChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    channels.push(this);
  }
  postMessage(data: unknown) {
    channels
      .filter((c) => c !== this && c.name === this.name)
      .forEach((c) => c.onmessage?.({ data }));
  }
  close() {
    channels.splice(channels.indexOf(this), 1);
  }
}
/** What the callback page broadcasts once it loads. */
const pageAnnounces = (data: unknown) => new FakeChannel('teable-oauth').postMessage(data);

describe('useConnectIntegration', () => {
  let popup: Window;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    channels.length = 0;
    popup = fakePopup();
    vi.mocked(openConnectIntegration).mockReturnValue(popup);
    listIntegrations.mockResolvedValue(grants([]));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it('is not a dismissal when the page closes itself before the grant is resolved', async () => {
    const { result, onConnected, onDismissed } = setup();
    act(() => {
      result.current.connect(AIRTABLE);
    });
    // The pre-connect baseline lands first; a fetch in flight would be shared.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The page announces success; the fetch that names the grant is slow.
    let resolveFetch: (value: unknown) => void = () => undefined;
    listIntegrations.mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)));
    act(() => pageAnnounces({ ok: true, provider: AIRTABLE }));
    // Its countdown ends and it closes its own window while that fetch is pending.
    (popup as unknown as { closed: boolean }).closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onDismissed).not.toHaveBeenCalled();

    await act(async () => {
      resolveFetch(grants(connected));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onConnected).toHaveBeenCalledWith(AIRTABLE, 'usi1');
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it('leaves the page its countdown, then closes the window as a backstop', async () => {
    const { result, onConnected } = setup();
    act(() => {
      result.current.connect(AIRTABLE);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    listIntegrations.mockResolvedValue(grants(connected));
    await act(async () => {
      pageAnnounces({ ok: true, provider: AIRTABLE });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onConnected).toHaveBeenCalledWith(AIRTABLE, 'usi1');
    expect(popup.close).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale close shut the window the next connect reuses', async () => {
    const { result, onConnected } = setup();
    act(() => {
      result.current.connect(AIRTABLE);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    listIntegrations.mockResolvedValue(grants(connected));
    await act(async () => {
      pageAnnounces({ ok: true, provider: AIRTABLE });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onConnected).toHaveBeenCalledTimes(1);

    // Within the linger window the user connects again: the named window is
    // reused for the next consent screen.
    listIntegrations.mockResolvedValue(grants([]));
    act(() => {
      result.current.connect(AIRTABLE);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(popup.close).not.toHaveBeenCalled();
    act(() => result.current.cancelConnect(AIRTABLE));
  });
});
