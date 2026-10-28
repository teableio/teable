import {
  CONSENT_REGION_COOKIE_NAME,
  MARKETING_CONSENT_COOKIE_NAME,
  allConsent,
} from '@teable/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_STATE_JS } from './Metrics';

// The GA / PostHog init snippets decide with this inline twin of getConsentSnapshot().
const consentState = () =>
  new Function(`${CONSENT_STATE_JS}; return __teableConsentState();`)() as Record<string, boolean>;

const DENIED = { analytics: false, ads: false, adUserData: false, adPersonalization: false };
const GRANTED = { analytics: true, ads: true, adUserData: true, adPersonalization: true };

describe('CONSENT_STATE_JS', () => {
  beforeEach(() => {
    document.cookie = `${CONSENT_REGION_COOKIE_NAME}=eea;path=/`;
    document.cookie = `${MARKETING_CONSENT_COOKIE_NAME}=${encodeURIComponent(
      JSON.stringify(allConsent('denied'))
    )};path=/`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const name of [CONSENT_REGION_COOKIE_NAME, MARKETING_CONSENT_COOKIE_NAME]) {
      document.cookie = `${name}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  });

  it('follows the stored choice in a browser', () => {
    expect(consentState()).toEqual(DENIED);
  });

  it('reads no cookies in a sandboxed iframe instead of throwing', () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => {
        throw new DOMException('The document is sandboxed.', 'SecurityError');
      },
    });
    try {
      expect(consentState()).toEqual(DENIED);
    } finally {
      Reflect.deleteProperty(document, 'cookie');
    }
  });

  it('grants everything inside the mobile app', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 TeableMobile/1.4.0'
    );
    expect(consentState()).toEqual(GRANTED);
  });
});
