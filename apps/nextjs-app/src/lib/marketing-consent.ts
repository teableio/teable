import type { ConsentMethod, ConsentRegion, IMarketingConsent } from '@teable/core';
import {
  CONSENT_BANNER_VERSION,
  CONSENT_REGION_COOKIE_NAME,
  MARKETING_CONSENT_COOKIE_NAME,
  MARKETING_CONSENT_MAX_AGE_SECONDS,
  isConsentGranted,
  parseMarketingConsent,
} from '@teable/core';
import { useSyncExternalStore } from 'react';

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
  /** Opt-in region with no recorded choice: the banner must be shown. */
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
let cached: { key: string; snapshot: IConsentSnapshot } | undefined;

const readCookie = (name: string): string | undefined =>
  document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const readSnapshot = (): IConsentSnapshot => {
  const regionRaw = readCookie(CONSENT_REGION_COOKIE_NAME);
  const consentRaw = readCookie(MARKETING_CONSENT_COOKIE_NAME);
  const key = `${regionRaw}|${consentRaw}|${settingsOpen}`;
  if (cached?.key === key) {
    return cached.snapshot;
  }
  const region: ConsentRegion = regionRaw === 'row' ? 'row' : 'eea';
  const consent = parseMarketingConsent(consentRaw);
  const snapshot: IConsentSnapshot = {
    region,
    consent,
    analyticsGranted: isConsentGranted(region, consent, 'analytics_storage'),
    adsGranted: isConsentGranted(region, consent, 'ad_storage'),
    needsChoice: region === 'eea' && !consent,
    settingsOpen,
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
  for (const item of document.cookie.split('; ')) {
    const name = item.split('=')[0];
    if (!name || !matches(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=;${domain ? `domain=${domain};` : ''}path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
  for (const key of Object.keys(window.localStorage)) {
    if (matches(key)) window.localStorage.removeItem(key);
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
  document.cookie =
    `${MARKETING_CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(consent))};` +
    `${parentCookieDomain()}path=/;max-age=${MARKETING_CONSENT_MAX_AGE_SECONDS};SameSite=Lax;${secure}`;
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
