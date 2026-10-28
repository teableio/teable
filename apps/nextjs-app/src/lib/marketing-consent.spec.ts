import {
  CONSENT_BANNER_VERSION,
  CONSENT_REGION_COOKIE_NAME,
  MARKETING_CONSENT_COOKIE_NAME,
  allConsent,
  consentForCategories,
  parseMarketingConsent,
} from '@teable/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeCookieSettings,
  getConsentSnapshot,
  openCookieSettings,
  saveConsent,
} from './marketing-consent';

const MOBILE_APP_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 TeableMobile/1.4.0';

const cookieNames = () =>
  document.cookie
    .split('; ')
    .map((item) => item.split('=')[0])
    .filter(Boolean);

const clearCookies = () => {
  for (const name of cookieNames()) {
    document.cookie = `${name}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
};

const savedConsent = () =>
  parseMarketingConsent(
    document.cookie
      .split('; ')
      .find((item) => item.startsWith(`${MARKETING_CONSENT_COOKIE_NAME}=`))
      ?.slice(MARKETING_CONSENT_COOKIE_NAME.length + 1)
  );

/**
 * Shadows the cookie jar. Another site's iframe reads none of Teable's SameSite=Lax cookies
 * and drops every write (`() => ''`); a sandboxed one throws on any access.
 */
const stubCookies = (get: () => string) =>
  Object.defineProperty(document, 'cookie', { configurable: true, get, set: () => undefined });
const restoreCookies = () => Reflect.deleteProperty(document, 'cookie');

/** A refused choice lives in module memory for the rest of the page: start a fresh one. */
const freshPage = async () => {
  vi.resetModules();
  return import('./marketing-consent');
};

describe('saveConsent', () => {
  const capture = vi.fn();

  beforeEach(() => {
    clearCookies();
    window.localStorage.clear();
    Object.assign(window, { posthog: { capture } });
    document.cookie = `${CONSENT_REGION_COOKIE_NAME}=eea;path=/`;
    document.cookie = '_ga=GA1.1.1;path=/';
    document.cookie = '_gcl_au=1.1.1;path=/';
    document.cookie = '_fbp=fb.1.1;path=/';
    window.localStorage.setItem('ph_phc_test_posthog', '{}');
  });

  afterEach(() => {
    capture.mockReset();
    closeCookieSettings();
    restoreCookies();
    vi.restoreAllMocks();
  });

  it('keeps analytics and clears only ad storage when just analytics is allowed', () => {
    const consent = consentForCategories({ analytics: true, marketing: false });
    saveConsent(consent, 'custom');

    expect(savedConsent()).toEqual(consent);
    const snapshot = getConsentSnapshot();
    expect(snapshot.analyticsGranted).toBe(true);
    expect(snapshot.adsGranted).toBe(false);
    expect(snapshot.needsChoice).toBe(false);

    const names = cookieNames();
    expect(names).toContain('_ga');
    expect(names).not.toContain('_gcl_au');
    expect(names).not.toContain('_fbp');
    expect(window.localStorage.getItem('ph_phc_test_posthog')).toBe('{}');
  });

  it('keeps ad storage and clears only analytics when just marketing is allowed', () => {
    saveConsent(consentForCategories({ analytics: false, marketing: true }), 'custom');

    const snapshot = getConsentSnapshot();
    expect(snapshot.analyticsGranted).toBe(false);
    expect(snapshot.adsGranted).toBe(true);

    const names = cookieNames();
    expect(names).not.toContain('_ga');
    expect(names).toContain('_gcl_au');
    expect(names).toContain('_fbp');
    expect(window.localStorage.getItem('ph_phc_test_posthog')).toBeNull();
  });

  it('records how the choice was made with the banner version', () => {
    const consent = consentForCategories({ analytics: true, marketing: false });
    saveConsent(consent, 'custom');

    expect(capture).toHaveBeenCalledWith('cookie_consent_updated', {
      ...consent,
      consent_region: 'eea',
      banner_version: CONSENT_BANNER_VERSION,
      consent_method: 'custom',
      source: 'app',
    });
  });

  it('applies a choice the browser refuses to store for the rest of the page', async () => {
    const page = await freshPage();
    stubCookies(() => '');
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    });

    page.saveConsent(allConsent('denied'), 'reject_all');
    expect(page.getConsentSnapshot()).toMatchObject({
      consent: allConsent('denied'),
      needsChoice: false,
      analyticsGranted: false,
    });
    expect(capture).toHaveBeenCalledWith(
      'cookie_consent_updated',
      expect.objectContaining({ consent_method: 'reject_all' })
    );

    page.saveConsent(allConsent('granted'), 'accept_all');
    expect(page.getConsentSnapshot()).toMatchObject({ analyticsGranted: true, adsGranted: true });
  });
});

describe('getConsentSnapshot', () => {
  beforeEach(() => {
    clearCookies();
    document.cookie = `${CONSENT_REGION_COOKIE_NAME}=eea;path=/`;
  });

  afterEach(() => {
    closeCookieSettings();
    restoreCookies();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('asks an undecided opt-in visitor in a browser', () => {
    const snapshot = getConsentSnapshot();
    expect(snapshot.needsChoice).toBe(true);
    expect(snapshot.analyticsGranted).toBe(false);
    expect(snapshot.adsGranted).toBe(false);
  });

  it('treats pages inside the mobile app as consented, whatever the cookies say', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(MOBILE_APP_UA);
    expect(getConsentSnapshot()).toMatchObject({
      needsChoice: false,
      analyticsGranted: true,
      adsGranted: true,
    });

    // A rejection stored before the app stopped asking does not count there either.
    document.cookie = `${MARKETING_CONSENT_COOKIE_NAME}=${encodeURIComponent(
      JSON.stringify(consentForCategories({ analytics: false, marketing: false }))
    )};path=/`;
    openCookieSettings();
    expect(getConsentSnapshot()).toMatchObject({
      needsChoice: false,
      settingsOpen: false,
      analyticsGranted: true,
      adsGranted: true,
    });
  });

  it('does not ask inside an iframe, where an undecided visitor keeps the opt-in defaults', () => {
    vi.stubGlobal('top', {});
    expect(getConsentSnapshot()).toMatchObject({
      needsChoice: false,
      analyticsGranted: false,
      adsGranted: false,
    });
  });

  it('reads no cookies in a sandboxed iframe instead of throwing', () => {
    vi.stubGlobal('top', {});
    stubCookies(() => {
      throw new DOMException('The document is sandboxed.', 'SecurityError');
    });
    expect(getConsentSnapshot()).toMatchObject({
      region: 'eea',
      needsChoice: false,
      analyticsGranted: false,
    });
  });

  it('does not treat a browser with ?embed=mobile as the app', () => {
    window.history.replaceState(null, '', '/base/bseX?embed=mobile');
    try {
      expect(getConsentSnapshot().needsChoice).toBe(true);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
