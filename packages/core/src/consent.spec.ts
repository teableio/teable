import { describe, expect, it } from 'vitest';
import { MARKETING_CONSENT_COOKIE_NAME, parseMarketingAdConsent } from './attribution';
import {
  allConsent,
  consentForCategories,
  consentRegionForCountry,
  isConsentGranted,
  normalizeCountryCode,
  parseMarketingConsent,
  adUserDataConsent,
  type AdUserDataConsent,
} from './consent';

describe('adUserDataConsent', () => {
  const cases: [
    consent: string | undefined,
    country: string | undefined,
    expected: AdUserDataConsent,
  ][] = [
    // granted: GRANTED everywhere
    ['granted', 'DE', 'GRANTED'],
    ['granted', 'US', 'GRANTED'],
    ['granted', undefined, 'GRANTED'],
    // denied: DENIED everywhere
    ['denied', 'DE', 'DENIED'],
    ['denied', 'US', 'DENIED'],
    ['denied', undefined, 'DENIED'],
    // no choice: DENIED only for a country known to be in EEA/UK/CH
    [undefined, 'DE', 'DENIED'],
    [undefined, 'GB', 'DENIED'],
    [undefined, 'CH', 'DENIED'],
    [undefined, 'NO', 'DENIED'],
    [undefined, 'US', 'GRANTED'],
    [undefined, 'jp', 'GRANTED'],
    // no choice and no country at all: opt-in, like the banner → DENIED
    [undefined, undefined, 'DENIED'],
    [undefined, '', 'DENIED'],
    // Cloudflare's placeholders: the banner treats them as outside the opt-in region
    [undefined, 'XX', 'GRANTED'],
    [undefined, 'T1', 'GRANTED'],
  ];

  it.each(cases)('consent=%s country=%s → %s', (consent, country, expected) => {
    expect(adUserDataConsent({ consent, country })).toBe(expected);
  });

  it('treats an unrecognised consent value as no choice', () => {
    expect(adUserDataConsent({ consent: 'maybe', country: 'FR' })).toBe('DENIED');
    expect(adUserDataConsent({ consent: 'maybe', country: 'US' })).toBe('GRANTED');
  });
});

describe('normalizeCountryCode', () => {
  it('keeps ISO codes and drops unknown placeholders', () => {
    expect(normalizeCountryCode(' us ')).toBe('US');
    expect(normalizeCountryCode('XX')).toBeUndefined();
    expect(normalizeCountryCode('T1')).toBeUndefined();
    expect(normalizeCountryCode('USA')).toBeUndefined();
    expect(normalizeCountryCode(null)).toBeUndefined();
  });
});

describe('parseMarketingAdConsent', () => {
  const read = (value: Record<string, string>) =>
    parseMarketingAdConsent({ [MARKETING_CONSENT_COOKIE_NAME]: JSON.stringify(value) });

  it('decides on ad_user_data', () => {
    expect(read({ ad_storage: 'granted', ad_user_data: 'denied' })).toBe('denied');
    expect(read({ ad_storage: 'granted', ad_user_data: 'granted' })).toBe('granted');
  });

  it('treats a denied ad_storage as a denial', () => {
    expect(read({ ad_storage: 'denied', ad_user_data: 'granted' })).toBe('denied');
  });

  it('falls back to ad_storage for payloads without ad_user_data', () => {
    expect(read({ ad_storage: 'granted' })).toBe('granted');
  });

  it('returns undefined without a choice', () => {
    expect(parseMarketingAdConsent({})).toBeUndefined();
    expect(
      parseMarketingAdConsent({ [MARKETING_CONSENT_COOKIE_NAME]: 'not-json' })
    ).toBeUndefined();
    expect(read({ analytics_storage: 'granted' })).toBeUndefined();
  });
});

describe('consentRegionForCountry', () => {
  it('maps EU, EEA, UK and CH to the opt-in region', () => {
    for (const country of ['DE', 'fr', 'NO', 'GB', 'CH', ' ie ']) {
      expect(consentRegionForCountry(country)).toBe('eea');
    }
  });

  it('maps everyone else to the opt-out region', () => {
    for (const country of ['US', 'CN', 'JP', 'XX']) {
      expect(consentRegionForCountry(country)).toBe('row');
    }
  });

  it('treats an unknown origin as opt-in', () => {
    expect(consentRegionForCountry(undefined)).toBe('eea');
    expect(consentRegionForCountry('')).toBe('eea');
  });
});

describe('parseMarketingConsent', () => {
  const granted = JSON.stringify(allConsent('granted'));

  it('reads plain, encoded and double-encoded cookies', () => {
    expect(parseMarketingConsent(granted)).toEqual(allConsent('granted'));
    expect(parseMarketingConsent(encodeURIComponent(granted))).toEqual(allConsent('granted'));
    expect(parseMarketingConsent(encodeURIComponent(encodeURIComponent(granted)))).toEqual(
      allConsent('granted')
    );
  });

  it('keeps only valid categories', () => {
    expect(parseMarketingConsent('{"ad_storage":"denied","analytics_storage":"maybe"}')).toEqual({
      ad_storage: 'denied',
    });
  });

  it('returns undefined for missing or malformed values', () => {
    expect(parseMarketingConsent(undefined)).toBeUndefined();
    expect(parseMarketingConsent('not-json')).toBeUndefined();
    expect(parseMarketingConsent('{"foo":"granted"}')).toBeUndefined();
  });
});

describe('isConsentGranted', () => {
  it('needs an explicit grant in the opt-in region', () => {
    expect(isConsentGranted('eea', undefined, 'analytics_storage')).toBe(false);
    expect(isConsentGranted('eea', allConsent('denied'), 'analytics_storage')).toBe(false);
    expect(isConsentGranted('eea', allConsent('granted'), 'analytics_storage')).toBe(true);
  });

  it('defaults to granted elsewhere unless rejected', () => {
    expect(isConsentGranted('row', undefined, 'ad_storage')).toBe(true);
    expect(isConsentGranted('row', allConsent('denied'), 'ad_storage')).toBe(false);
  });
});

describe('consentForCategories', () => {
  it('maps analytics to analytics_storage and marketing to every ad signal', () => {
    expect(consentForCategories({ analytics: true, marketing: false })).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    expect(consentForCategories({ analytics: false, marketing: true })).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });

  it('matches the all-or-nothing choices at the extremes', () => {
    expect(consentForCategories({ analytics: true, marketing: true })).toEqual(
      allConsent('granted')
    );
    expect(consentForCategories({ analytics: false, marketing: false })).toEqual(
      allConsent('denied')
    );
  });

  it('keeps a custom choice per category under either region', () => {
    const consent = consentForCategories({ analytics: true, marketing: false });
    for (const region of ['eea', 'row'] as const) {
      expect(isConsentGranted(region, consent, 'analytics_storage')).toBe(true);
      expect(isConsentGranted(region, consent, 'ad_storage')).toBe(false);
    }
  });
});
