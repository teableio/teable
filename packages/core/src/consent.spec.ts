import { describe, expect, it } from 'vitest';
import {
  allConsent,
  consentRegionForCountry,
  isConsentGranted,
  parseMarketingConsent,
} from './consent';

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
