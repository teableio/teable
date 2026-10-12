import { useEffect, useState } from 'react';
import { detectEmbedMode } from '@/lib/embed-mode';
import { useEnv } from './useEnv';

/**
 * Whether the page runs inside the native mobile app's WebView (`?embed=mobile`
 * or a `TeableMobile/` user agent). Layouts use it to drop the base / space
 * sidebar, the AI chat panel and the floating chat button, and the base home
 * stops redirecting so the native directory tree owns navigation.
 *
 * Two sources, combined so server and client markup always agree:
 *  - `env.embedMode`, set by `withEnv` from the request (query or user agent).
 *    It is part of the page props, so it is identical during SSR and hydration
 *    and embed pages render without the chrome from the first paint.
 *  - client detection after mount (query → sessionStorage → user agent), the
 *    fallback for client-side transitions and pages whose props lack the flag.
 * When the request was not flagged this is `false` on the server and during
 * hydration and only flips in an effect, so it can never cause a mismatch.
 */
export const useEmbedMode = (): boolean => {
  const { embedMode: serverEmbedMode } = useEnv();
  const [clientEmbedMode, setClientEmbedMode] = useState(false);

  useEffect(() => {
    setClientEmbedMode(detectEmbedMode());
  }, []);

  return Boolean(serverEmbedMode) || clientEmbedMode;
};
