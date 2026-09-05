/**
 * Embed mode: the native mobile app (enterprise/mobile) opens content pages in
 * a WebView with `?embed=mobile` appended and `TeableMobile/<version>` in the
 * user agent. In that mode the Web app drops the chrome the shell provides
 * natively (base / space sidebar, AI chat panel, floating chat button) and the
 * base home never auto-redirects. This module holds the detection rules shared
 * by SSR (`withEnv`, `getBaseServerSideProps`) and the client (`useEmbedMode`).
 */

/** Query key / value the native shell appends to every page it opens. */
export const EMBED_MODE_QUERY_KEY = 'embed';
export const EMBED_MODE_MOBILE = 'mobile';
/**
 * sessionStorage key persisting a query hit, so client-side route changes that
 * drop the query keep embed mode for the rest of the WebView session.
 */
export const EMBED_MODE_STORAGE_KEY = 'teable.embed';
/** User-agent marker the native WebView appends (`TeableMobile/<version>`). */
export const MOBILE_APP_UA_MARKER = 'TeableMobile/';

export const isMobileAppUserAgent = (userAgent: string | string[] | null | undefined): boolean => {
  const value = Array.isArray(userAgent) ? userAgent[0] : userAgent;
  return typeof value === 'string' && value.includes(MOBILE_APP_UA_MARKER);
};

/** `embed=mobile` as parsed by Next (`ctx.query`) or by `URLSearchParams`. */
export const isMobileEmbedQueryValue = (value: unknown): boolean =>
  value === EMBED_MODE_MOBILE || (Array.isArray(value) && value.includes(EMBED_MODE_MOBILE));

export const hasMobileEmbedQuery = (search: string): boolean => {
  try {
    return new URLSearchParams(search).get(EMBED_MODE_QUERY_KEY) === EMBED_MODE_MOBILE;
  } catch {
    return false;
  }
};

export interface IEmbedModeClientEnv {
  /** `window.location.search` */
  search?: string;
  userAgent?: string | null;
  /** `window.sessionStorage`; may be unavailable in locked-down WebViews */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const getBrowserEnv = (): IEmbedModeClientEnv | undefined => {
  if (typeof window === 'undefined') return undefined;
  let storage: IEmbedModeClientEnv['storage'] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return { search: window.location.search, userAgent: window.navigator.userAgent, storage };
};

/**
 * Client-side detection: `?embed=mobile` (persisted to sessionStorage when the
 * mobile app's WebView sent it), a hit persisted earlier in the session, or the
 * mobile app user agent. Always `false` outside a browser.
 */
export const detectEmbedMode = (
  env: IEmbedModeClientEnv | undefined = getBrowserEnv()
): boolean => {
  if (!env) return false;
  const { search = '', userAgent, storage } = env;
  if (hasMobileEmbedQuery(search)) {
    // Persist only for the app's WebView: a desktop tab that opens a shared link with the
    // query still renders that page without chrome, but must not lose it for the session.
    if (isMobileAppUserAgent(userAgent)) {
      try {
        storage?.setItem(EMBED_MODE_STORAGE_KEY, EMBED_MODE_MOBILE);
      } catch {
        // storage quota / privacy mode: the user-agent check still covers the shell
      }
    }
    return true;
  }
  try {
    if (storage?.getItem(EMBED_MODE_STORAGE_KEY) === EMBED_MODE_MOBILE) return true;
  } catch {
    // unreadable storage: fall through to the user agent
  }
  return isMobileAppUserAgent(userAgent);
};

interface IEmbedModeRequestContext {
  query: Record<string, unknown>;
  req?: { headers?: Record<string, string | string[] | undefined> };
}

/**
 * Server-side detection for `getServerSideProps`: the query the shell appends
 * to the initial load, or the WebView user agent (sent on every request,
 * including the `_next/data` fetches behind client-side transitions).
 */
export const isEmbedModeRequest = (context: IEmbedModeRequestContext): boolean =>
  isMobileEmbedQueryValue(context.query[EMBED_MODE_QUERY_KEY]) ||
  isMobileAppUserAgent(context.req?.headers?.['user-agent']);
