import { useQueryClient } from '@tanstack/react-query';
import {
  findChangedUserIntegration,
  getUserIntegrationList,
  userIntegrationBaseline,
  type IUserIntegrationBaseline,
  type UserIntegrationProvider,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import React from 'react';
import { openConnectIntegration } from './utils';

// Kept in sync with the backend callback page (oauth-callback-page.ts),
// which broadcasts `{ok,provider}` on this channel.
const OAUTH_BROADCAST_CHANNEL = 'teable-oauth';
// A callback page that reached us over the channel is one whose script runs: it
// shows "connected", counts down three seconds and closes its own window. Closing
// it from here the instant the broadcast lands would cut that confirmation to a
// flash, so the opener waits this long and only then closes it — insurance for a
// browser that refused the page's own close.
const CALLBACK_PAGE_LINGER_MS = 4000;
const CONNECT_POLL_MS = 2000; // poll the integration list every 2s while connecting
// Cadence once the popup is gone. The poll stays alive because a popup can only
// *look* closed (see `dismiss`), but that reading is rare and the broadcast
// covers it anyway unless PUBLIC_ORIGIN differs from the app origin — not worth
// ~150 requests behind a window the user did in fact close.
const DISMISSED_POLL_MS = 6000;
const CONNECT_TIMEOUT_MS = 10 * 60 * 1000; // give up on a connect that never lands
// How often to check whether the popup is still there. Closing it is the only
// trace a user leaves when they abandon the consent screen — nothing is
// broadcast — so this watch is what keeps that case from holding the caller's
// "connecting" state for the poll's full 10 minutes.
const POPUP_WATCH_MS = 800;

// Providers with a connect poll already running. Module-level (not a ref) so a
// detached poll survives the caller unmounting (e.g. a menu or dialog closing)
// and a second click can't start a duplicate poll for the same provider.
interface IConnectInFlight {
  /** Abort the poll without firing any callback. */
  cancel: () => void;
  /** True once the popup was seen gone — the poll listens on, see `dismiss`. */
  isDismissed: () => boolean;
}
const connectInFlight = new Map<UserIntegrationProvider, IConnectInFlight>();
/**
 * The delayed close of a popup whose page is counting down (see
 * CALLBACK_PAGE_LINGER_MS). Module-level because every native connect opens the
 * SAME named window (`teable-oauth`): a connect started inside that window
 * navigates it to the next provider's consent screen, and a close still pending
 * from the previous success would shut that screen in the user's face.
 */
let pendingPopupClose: ReturnType<typeof setTimeout> | undefined;

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
  /**
   * Fired when the OAuth popup went away without a result — the user closed it,
   * or COOP severed the reference (indistinguishable from the opener). Not a
   * failure: the connect keeps listening, so an authorization that is still
   * running can still resolve as onConnected. Treat it as the cue to leave the
   * "connecting" state and let the user click connect again.
   */
  onDismissed?: (provider: UserIntegrationProvider) => void;
}

/**
 * Shared OAuth connect flow for user integrations. Opens the provider's OAuth
 * popup, then detects success two ways: the same-origin callback page broadcasts
 * on a BroadcastChannel (instant), and as a fallback we poll the integration list
 * (the callback page's own window.close() is best-effort, so the popup often
 * lingers). On success we close the lingering popup from the opener, refresh the
 * integration list, and fire onConnected — so finishing OAuth auto-closes the
 * window in every caller instead of leaving the user to close it manually.
 *
 * A popup that goes away without a result fires onDismissed and releases
 * `isConnecting` while the listeners stay armed — see `dismiss` below.
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
  const onDismissedRef = React.useRef(options?.onDismissed);
  onDismissedRef.current = options?.onDismissed;
  const [inFlightCount, setInFlightCount] = React.useState(0);

  const connect = React.useCallback(
    (provider: UserIntegrationProvider, queryParams?: Record<string, string>) => {
      const running = connectInFlight.get(provider);
      if (running) {
        // A live connect owns this provider's popup — a second click must not
        // start a duplicate poll.
        if (!running.isDismissed()) return true;
        // Its popup is gone (or unreachable): abandon it so this click opens a
        // fresh one instead of silently doing nothing.
        running.cancel();
      }
      // This connect takes the named window over; a close the last success left
      // scheduled for it must not fire on the new consent screen.
      if (pendingPopupClose) {
        clearTimeout(pendingPopupClose);
        pendingPopupClose = undefined;
      }
      // queryParams (name / integrationId) are passed straight through to the
      // authorize URL — the caller owns them (a reconnect must not be renamed).
      const popup = openConnectIntegration(provider, queryParams);
      if (!popup) return false; // popup blocked — nothing will ever resolve this connect
      // Placeholder so the in-flight guard holds; the real handle is registered
      // below in the same synchronous block.
      connectInFlight.set(provider, { cancel: () => undefined, isDismissed: () => false });
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
      // a *change* rather than "any grant exists" — see userIntegrationBaseline for why
      // the latter false-positives and closes the popup mid-OAuth.
      let baseline: IUserIntegrationBaseline | null = null;
      void fetchIntegrations().then((data) => {
        baseline = userIntegrationBaseline(data?.integrations ?? [], provider);
      });

      // A deadline, not a tick count: the poll changes cadence on dismissal and
      // the ~5 min bound has to stay the same either way.
      const deadline = Date.now() + CONNECT_TIMEOUT_MS;
      let settled = false;
      let dismissed = false;
      let holdsUi = true;
      // Set the moment the callback page reports success. The page closes its own
      // window after its countdown, which can land while the fetch that resolves
      // the grant id is still running; without this flag that close would read as
      // an abandonment and tell the caller "dismissed" just before "connected".
      let successSignalled = false;

      const channel = (() => {
        try {
          return new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
        } catch {
          return undefined;
        }
      })();

      const findChangedIntegrationId = (
        data: Awaited<ReturnType<typeof fetchIntegrations>>
      ): string | undefined =>
        baseline
          ? findChangedUserIntegration(data?.integrations ?? [], provider, baseline)?.id
          : undefined;

      // Hand the caller's "connecting" state back. Separate from teardown: a
      // dismissed connect releases the UI while its listeners stay armed.
      const releaseUi = () => {
        if (!holdsUi) return;
        holdsUi = false;
        setInFlightCount((count) => Math.max(0, count - 1));
      };
      const teardown = () => {
        clearInterval(timer);
        clearInterval(popupWatch);
        channel?.close();
        connectInFlight.delete(provider);
        releaseUi();
      };
      // Stop listening without telling the caller anything.
      const stopListening = () => {
        if (settled) return;
        settled = true;
        teardown();
      };
      const closePopup = () => {
        try {
          popup.close(); // best-effort; COOP may neuter the reference (no-op)
        } catch {
          // cross-origin popup reference may be severed — ignore
        }
      };
      const succeed = (integrationId?: string, opts?: { pageClosesItself?: boolean }) => {
        if (settled) return; // broadcast and poll can both fire — run once
        settled = true;
        teardown();
        if (opts?.pageClosesItself) {
          pendingPopupClose = setTimeout(() => {
            pendingPopupClose = undefined;
            closePopup();
          }, CALLBACK_PAGE_LINGER_MS);
        } else {
          closePopup();
        }
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
      // The popup went away without a result. NOT a failure: any COOP value
      // other than unsafe-none on a provider's page severs the opener's
      // reference and makes a still-open popup read as closed, so both readings
      // have to stay safe. What ends here is only the caller's "connecting"
      // state — the broadcast and poll listeners stay armed, so an
      // authorization the user is still working through resolves as usual.
      // Without this a consent screen closed on the first step spins the
      // caller's button for the poll's full ~10 minutes.
      const dismiss = () => {
        if (settled || dismissed) return;
        // The page announced success and closed itself: the fetch in flight will
        // settle this connect as connected, and nothing is abandoned.
        if (successSignalled) return;
        dismissed = true;
        clearInterval(popupWatch);
        // Same deadline, far fewer requests: nothing is expected to come back
        // through a window that is gone, this is only the insurance policy.
        clearInterval(timer);
        timer = setInterval(poll, DISMISSED_POLL_MS);
        releaseUi();
        onDismissedRef.current?.(provider);
      };
      // Cancel: abort a connect the caller no longer cares about (e.g. an
      // agent gate was dismissed mid-connect) so the provider frees up for a
      // fresh connect instead of staying locked until the poll times out.
      // Fires neither onConnected nor onFailed.
      connectInFlight.set(provider, {
        cancel: () => {
          stopListening();
          closePopup();
        },
        isDismissed: () => dismissed,
      });

      // Instant path: the same-origin callback page posts {ok,provider} the
      // moment it loads — authoritative, so succeed directly. BroadcastChannel
      // may be unusable when PUBLIC_ORIGIN differs from the app origin; the poll
      // below is the fallback.
      if (channel) {
        channel.onmessage = (e) => {
          if (e.data?.provider !== provider) return;
          if (e.data?.ok) {
            successSignalled = true;
            // Resolve the new/updated grant id before reporting success.
            void fetchIntegrations().then(
              (data) => succeed(findChangedIntegrationId(data), { pageClosesItself: true }),
              () => succeed(undefined, { pageClosesItself: true })
            );
          } else if (e.data?.ok === false) {
            fail(typeof e.data?.error === 'string' ? e.data.error : undefined);
          }
        };
      }

      // Fallback path: poll until a grant for this provider is new or its
      // connectedTime advanced (reconnect), then finish; bound a cancelled
      // connect by the deadline.
      const poll = () => {
        void (async () => {
          const data = await fetchIntegrations();
          if (!baseline) return; // wait until the pre-connect snapshot is ready
          const changedId = findChangedIntegrationId(data);
          if (changedId !== undefined) {
            succeed(changedId);
          } else if (Date.now() >= deadline && !settled) {
            // A dismissed connect was already reported; don't resurface it as an
            // error minutes after the user moved on — just stop listening.
            if (dismissed) {
              stopListening();
            } else {
              fail('Timed out waiting for authorization');
            }
          }
        })();
      };
      let timer = setInterval(poll, CONNECT_POLL_MS);

      // popup.closed is one-way (never flips back) and cheap to read, and it is
      // the only cancellation signal there is — see `dismiss` for why a closed
      // popup is not treated as a failure.
      const popupWatch = setInterval(() => {
        if (popup.closed) dismiss();
      }, POPUP_WATCH_MS);
      return true;
    },
    [queryClient]
  );

  // Abort an in-flight connect for the provider (no callback fires). No-op
  // when none is running.
  const cancelConnect = React.useCallback((provider: UserIntegrationProvider) => {
    connectInFlight.get(provider)?.cancel();
  }, []);

  return { connect, cancelConnect, isConnecting: inFlightCount > 0 };
};
