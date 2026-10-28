import type { ConsentMethod, ConsentRegion, IMarketingConsent } from '@teable/core';
import {
  CONSENT_BANNER_VERSION,
  CONSENT_REGION_COOKIE_NAME,
  MARKETING_CONSENT_COOKIE_NAME,
  MARKETING_CONSENT_MAX_AGE_SECONDS,
  allConsent,
  isConsentGranted,
  parseMarketingConsent,
} from '@teable/core';
import { useSyncExternalStore } from 'react';
import { isMobileAppUserAgent } from './embed-mode';

/**
 * Client-side view of the visitor's cookie consent, shared by the banner and
 * every tracker in components/Metrics.tsx. The choice lives in the
 * `teable_consent` cookie on the parent domain, so a choice made on the
 * marketing site (teable.ai) is honoured here and vice versa.
 */
export interface IConsentSnapshot {
  region: ConsentRegion;
  consent: Partial<IMarketingConsent> | undefined;
  analyticsGranted: boolean;
  adsGranted: boolean;
  /** Opt-in region with no recorded choice, outside an iframe: the banner must be shown. */
  needsChoice: boolean;
  /** "Cookie settings" was opened explicitly: the banner opens on its per-category panel. */
  settingsOpen: boolean;
}

const CHANGE_EVENT = 'teable:consent-changed';

const SERVER_SNAPSHOT: IConsentSnapshot = {
  region: 'eea',
  consent: undefined,
  analyticsGranted: false,
  adsGranted: false,
  needsChoice: false,
  settingsOpen: false,
};

let settingsOpen = false;
// A choice the browser refused to store (see saveConsent), honoured for the rest of this page.
let pageOnlyConsent: string | undefined;
let cached: { key: string; snapshot: IConsentSnapshot } | undefined;

// A sandboxed iframe (no allow-same-origin) throws on document.cookie. Every tracker reads
// consent while rendering, so a throw here would take the whole page down: read no cookies.
const readCookies = (): string[] => {
  try {
    return document.cookie.split('; ');
  } catch {
    return [];
  }
};

const readCookie = (name: string): string | undefined =>
  readCookies()
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/**
 * Pages the Teable mobile app shows in its WebView (recognised by the
 * `TeableMobile/` user agent it sends on every request) count as consented:
 * the person agreed when signing in to the app, so they are never asked again
 * there and nothing is recorded or stored on their behalf. Only the user
 * agent counts — a `?embed=mobile` link opened in a browser is still a browser.
 */
const IN_APP_CONSENT = allConsent('granted');

const isInMobileApp = (): boolean => isMobileAppUserAgent(window.navigator.userAgent);

/**
 * Inside an iframe (a shared form embedded on another site, say) the banner
 * never opens by itself: the embedding page owns the visitor's consent prompt.
 * A cross-site frame can't keep Teable's cookies anyway — browsers drop
 * SameSite=Lax cookies there and Safari drops every third-party cookie — so it
 * can't read the region either and keeps the opt-in defaults: nothing is
 * stored and PostHog counts cookieless.
 */
const isFramed = (): boolean => window.self !== window.top;

const readSnapshot = (): IConsentSnapshot => {
  const regionRaw = readCookie(CONSENT_REGION_COOKIE_NAME);
  const consentRaw = pageOnlyConsent ?? readCookie(MARKETING_CONSENT_COOKIE_NAME);
  const inApp = isInMobileApp();
  const framed = isFramed();
  const key = `${regionRaw}|${consentRaw}|${settingsOpen}|${inApp}|${framed}`;
  if (cached?.key === key) {
    return cached.snapshot;
  }
  const region: ConsentRegion = regionRaw === 'row' ? 'row' : 'eea';
  const consent = inApp ? IN_APP_CONSENT : parseMarketingConsent(consentRaw);
  const snapshot: IConsentSnapshot = {
    region,
    consent,
    analyticsGranted: isConsentGranted(region, consent, 'analytics_storage'),
    adsGranted: isConsentGranted(region, consent, 'ad_storage'),
    needsChoice: region === 'eea' && !consent && !framed,
    settingsOpen: settingsOpen && !inApp,
  };
  cached = { key, snapshot };
  return snapshot;
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
};

export const useMarketingConsent = (): IConsentSnapshot =>
  useSyncExternalStore(subscribe, readSnapshot, () => SERVER_SNAPSHOT);

/** Synchronous read for non-React callers (init snippets run before effects). */
export const getConsentSnapshot = (): IConsentSnapshot =>
  typeof document === 'undefined' ? SERVER_SNAPSHOT : readSnapshot();

const parentCookieDomain = (): string => {
  const host = window.location.hostname;
  for (const root of ['teable.ai', 'teable.cn']) {
    if (host === root || host.endsWith(`.${root}`)) {
      return `domain=.${root};`;
    }
  }
  return '';
};

// Identifiers left behind by a category the visitor has just rejected.
// Matches the cleanup the marketing site does on "Reject all".
const ANALYTICS_STORAGE = [/^_ga(_|$)/, /^ph_.+_posthog$/];
const ADS_STORAGE = [/^_gcl_/, /^_fbp$/, /^_fbc$/];

const clearStorage = (patterns: RegExp[]) => {
  const matches = (name: string) => patterns.some((pattern) => pattern.test(name));
  const hostname = window.location.hostname;
  const domains = ['', hostname, `.${hostname}`];
  const parent = parentCookieDomain().match(/^domain=(.+);$/)?.[1];
  if (parent) domains.push(parent);
  // Expire with a past date rather than max-age=0: every browser honours it, and
  // test DOMs (happy-dom) keep max-age=0 cookies.
  for (const item of readCookies()) {
    const name = item.split('=')[0];
    if (!name || !matches(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=;${domain ? `domain=${domain};` : ''}path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (matches(key)) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage is blocked (cookies off, a third-party frame): nothing was stored there.
  }
};

export const openCookieSettings = () => {
  settingsOpen = true;
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

/**
 * Persists a choice, notifies the trackers, and records it as a PostHog
 * event (proof of consent), along with how it was made. The event is sent for
 * rejections too — PostHog then runs cookieless, so no identifier is stored.
 */
export const saveConsent = (consent: IMarketingConsent, method: ConsentMethod) => {
  const secure = window.location.protocol === 'https:' ? 'Secure;' : '';
  const value = encodeURIComponent(JSON.stringify(consent));
  document.cookie =
    `${MARKETING_CONSENT_COOKIE_NAME}=${value};` +
    `${parentCookieDomain()}path=/;max-age=${MARKETING_CONSENT_MAX_AGE_SECONDS};SameSite=Lax;${secure}`;
  // The browser may refuse the cookie (a cross-site iframe, cookies blocked). The choice
  // must still close the banner and reach the trackers, so this page keeps it in memory.
  pageOnlyConsent = readCookie(MARKETING_CONSENT_COOKIE_NAME) === value ? undefined : value;
  settingsOpen = false;
  if (consent.analytics_storage === 'denied') {
    clearStorage(ANALYTICS_STORAGE);
  }
  if (consent.ad_storage === 'denied') {
    clearStorage(ADS_STORAGE);
  }
  const snapshot = readSnapshot();
  window.dispatchEvent(new Event(CHANGE_EVENT));
  window.posthog?.capture('cookie_consent_updated', {
    ...consent,
    consent_region: snapshot.region,
    banner_version: CONSENT_BANNER_VERSION,
    consent_method: method,
    source: 'app',
  });
};

export const closeCookieSettings = () => {
  settingsOpen = false;
  window.dispatchEvent(new Event(CHANGE_EVENT));
};
