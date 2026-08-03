import { useQueryClient } from '@tanstack/react-query';
import { getUserIntegrationList, type UserIntegrationProvider } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import React from 'react';
import { openConnectIntegration } from './utils';

// Kept in sync with the backend callback page (oauth.controller.ts
// renderCallbackPage), which broadcasts `{ok,provider}` on this channel.
const OAUTH_BROADCAST_CHANNEL = 'teable-oauth';
const CONNECT_POLL_MS = 2000; // poll the integration list every 2s while connecting
// ~5 min cap. popup.closed is unusable (COOP severs the reference post-OAuth), so
// a cancelled connect can only be bounded by this timeout, not by the popup closing.
const CONNECT_POLL_MAX = 150;

// Providers with a connect poll already running, mapped to a function that
// aborts that poll. Module-level (not a ref) so a detached poll survives the
// caller unmounting (e.g. a menu or dialog closing) and a second click can't
// start a duplicate poll for the same provider.
const connectInFlight = new Map<UserIntegrationProvider, () => void>();

interface IUseConnectIntegrationOptions {
  /**
   * Fired once, after the integration is confirmed connected and the popup
   * closed. `integrationId` is the new/updated grant, resolved by diffing the
   * integration list against the pre-connect baseline (undefined when the
   * baseline snapshot was not ready yet).
   */
  onConnected?: (provider: UserIntegrationProvider, integrationId?: string) => void;
  /** Fired when the callback page broadcasts a failure or the connect poll times out. */
  onFailed?: (provider: UserIntegrationProvider, error?: string) => void;
}

/**
 * Shared OAuth connect flow for user integrations. Opens the provider's OAuth
 * popup, then detects success two ways: the same-origin callback page broadcasts
 * on a BroadcastChannel (instant), and as a fallback we poll the integration list
 * (popup.closed is unusable — COOP severs the reference post-OAuth, so the
 * callback page's window.close() is best-effort and the popup often lingers). On
 * success we close the lingering popup from the opener, refresh the integration
 * list, and fire onConnected — so finishing OAuth auto-closes the window in every
 * caller instead of leaving the user to close it manually.
 *
 * `connect` returns false when the browser blocked the popup (no callback will
 * ever fire), true otherwise.
 */
export const useConnectIntegration = (options?: IUseConnectIntegrationOptions) => {
  const queryClient = useQueryClient();
  // Keep the latest callbacks without changing connect()'s identity.
  const onConnectedRef = React.useRef(options?.onConnected);
  onConnectedRef.current = options?.onConnected;
  const onFailedRef = React.useRef(options?.onFailed);
  onFailedRef.current = options?.onFailed;
  const [inFlightCount, setInFlightCount] = React.useState(0);

  const connect = React.useCallback(
    (provider: UserIntegrationProvider, queryParams?: Record<string, string>) => {
      if (connectInFlight.has(provider)) return true; // a connect for this provider is already running
      // queryParams (name / integrationId) are passed straight through to the
      // authorize URL — the caller owns them (a reconnect must not be renamed).
      const popup = openConnectIntegration(provider, queryParams);
      if (!popup) return false; // popup blocked — nothing will ever resolve this connect
      // Placeholder so the in-flight guard holds; the real cancel function is
      // registered below in the same synchronous block.
      connectInFlight.set(provider, () => undefined);
      setInFlightCount((count) => count + 1);

      const fetchIntegrations = () =>
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getUserIntegrations(),
          queryFn: () => getUserIntegrationList().then((res) => res.data),
          // Force a real fetch: the global ~10s staleTime would otherwise keep
          // serving the pre-connect snapshot and the change would never be seen.
          staleTime: 0,
        });

      // Snapshot this provider's grants before connecting so the poll can detect
      // a *change* rather than "any grant exists" — the latter is already true
      // when adding a second account of a connected provider or reconnecting,
      // which would false-positive and close the popup mid-OAuth.
      let baseline: Record<string, number> | null = null;
      void fetchIntegrations().then((data) => {
        baseline = Object.fromEntries(
          (data?.integrations ?? [])
            .filter((item) => item.provider === provider)
            .map((item) => [item.id, item.connectedTime ? Date.parse(item.connectedTime) : 0])
        );
      });

      let attempts = 0;
      let settled = false;

      const channel = (() => {
        try {
          return new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
        } catch {
          return undefined;
        }
      })();

      // A grant is "changed" when it is new or its connectedTime advanced
      // (reconnect) relative to the pre-connect baseline.
      const findChangedIntegrationId = (
        data: Awaited<ReturnType<typeof fetchIntegrations>>
      ): string | undefined => {
        if (!baseline) return undefined;
        return (data?.integrations ?? []).find((item) => {
          if (item.provider !== provider || !item.hasSecret) return false;
          const previous = baseline?.[item.id];
          const current = item.connectedTime ? Date.parse(item.connectedTime) : 0;
          return previous === undefined || current > previous;
        })?.id;
      };

      const teardown = () => {
        clearInterval(timer);
        channel?.close();
        connectInFlight.delete(provider);
        setInFlightCount((count) => Math.max(0, count - 1));
      };
      const closePopup = () => {
        try {
          popup.close(); // best-effort; COOP may neuter the reference (no-op)
        } catch {
          // cross-origin popup reference may be severed — ignore
        }
      };
      const succeed = (integrationId?: string) => {
        if (settled) return; // broadcast and poll can both fire — run once
        settled = true;
        teardown();
        closePopup();
        void queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getUserIntegrations() });
        onConnectedRef.current?.(provider, integrationId);
      };
      // Unlike succeed, leave the popup open: on a broadcast failure it shows the
      // error page (and closes itself), and on a poll timeout the user may still
      // be mid-OAuth.
      const fail = (error?: string) => {
        if (settled) return;
        settled = true;
        teardown();
        onFailedRef.current?.(provider, error);
      };
      // Cancel: abort a connect the caller no longer cares about (e.g. an
      // agent gate was dismissed mid-connect) so the provider frees up for a
      // fresh connect instead of staying locked until the poll times out.
      // Fires neither onConnected nor onFailed.
      connectInFlight.set(provider, () => {
        if (settled) return;
        settled = true;
        teardown();
        closePopup();
      });

      // Instant path: the same-origin callback page posts {ok,provider} the
      // moment it loads — authoritative, so succeed directly. BroadcastChannel
      // may be unusable when PUBLIC_ORIGIN differs from the app origin; the poll
      // below is the fallback.
      if (channel) {
        channel.onmessage = (e) => {
          if (e.data?.provider !== provider) return;
          if (e.data?.ok) {
            // Resolve the new/updated grant id before reporting success.
            void fetchIntegrations().then(
              (data) => succeed(findChangedIntegrationId(data)),
              () => succeed()
            );
          } else if (e.data?.ok === false) {
            fail(typeof e.data?.error === 'string' ? e.data.error : undefined);
          }
        };
      }

      // Fallback path: poll until a grant for this provider is new or its
      // connectedTime advanced (reconnect), then finish; bound a cancelled
      // connect by the timeout.
      const timer = setInterval(() => {
        attempts += 1;
        void (async () => {
          const data = await fetchIntegrations();
          if (!baseline) return; // wait until the pre-connect snapshot is ready
          const changedId = findChangedIntegrationId(data);
          if (changedId !== undefined) {
            succeed(changedId);
          } else if (attempts >= CONNECT_POLL_MAX && !settled) {
            fail('Timed out waiting for authorization');
          }
        })();
      }, CONNECT_POLL_MS);
      return true;
    },
    [queryClient]
  );

  // Abort an in-flight connect for the provider (no callback fires). No-op
  // when none is running.
  const cancelConnect = React.useCallback((provider: UserIntegrationProvider) => {
    connectInFlight.get(provider)?.();
  }, []);

  return { connect, cancelConnect, isConnecting: inFlightCount > 0 };
};
