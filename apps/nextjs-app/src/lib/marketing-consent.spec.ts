import {
  CONSENT_BANNER_VERSION,
  CONSENT_REGION_COOKIE_NAME,
  MARKETING_CONSENT_COOKIE_NAME,
  consentForCategories,
  parseMarketingConsent,
} from '@teable/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeCookieSettings, getConsentSnapshot, saveConsent } from './marketing-consent';

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
});
