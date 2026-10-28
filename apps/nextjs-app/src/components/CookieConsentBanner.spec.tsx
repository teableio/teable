import {
  CONSENT_REGION_COOKIE_NAME,
  MARKETING_CONSENT_COOKIE_NAME,
  consentForCategories,
  parseMarketingConsent,
} from '@teable/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeCookieSettings, openCookieSettings } from '@/lib/marketing-consent';
import { CookieConsentBanner } from './CookieConsentBanner';

vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const clearCookies = () => {
  for (const item of document.cookie.split('; ')) {
    const name = item.split('=')[0];
    if (name) document.cookie = `${name}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
};

const setRegion = (region: 'eea' | 'row') => {
  document.cookie = `${CONSENT_REGION_COOKIE_NAME}=${region};path=/`;
};

const setSavedConsent = (consent: object) => {
  document.cookie = `${MARKETING_CONSENT_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify(consent)
  )};path=/`;
};

const savedConsent = () =>
  parseMarketingConsent(
    document.cookie
      .split('; ')
      .find((item) => item.startsWith(`${MARKETING_CONSENT_COOKIE_NAME}=`))
      ?.slice(MARKETING_CONSENT_COOKIE_NAME.length + 1)
  );

const switchFor = (category: string) =>
  screen.getByRole('switch', { name: `cookieConsent.categories.${category}.title` });

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    clearCookies();
  });

  afterEach(() => {
    act(() => closeCookieSettings());
  });

  it('offers reject, accept and customize to a first-time opt-in visitor', () => {
    setRegion('eea');
    render(<CookieConsentBanner enabled />);

    expect(screen.getByRole('button', { name: 'cookieConsent.reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cookieConsent.accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cookieConsent.customize' })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('saves a custom choice with only analytics allowed', () => {
    setRegion('eea');
    render(<CookieConsentBanner enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'cookieConsent.customize' }));

    expect(switchFor('necessary')).toBeChecked();
    expect(switchFor('necessary')).toBeDisabled();
    expect(switchFor('analytics')).not.toBeChecked();
    expect(switchFor('marketing')).not.toBeChecked();

    fireEvent.click(switchFor('analytics'));
    fireEvent.click(screen.getByRole('button', { name: 'cookieConsent.save' }));

    expect(savedConsent()).toEqual(consentForCategories({ analytics: true, marketing: false }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens Cookie settings on the saved choice', () => {
    setRegion('eea');
    setSavedConsent(consentForCategories({ analytics: true, marketing: false }));
    render(<CookieConsentBanner enabled />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => openCookieSettings());

    expect(switchFor('analytics')).toBeChecked();
    expect(switchFor('marketing')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'actions.cancel' })).toBeInTheDocument();
  });

  it('defaults every category on outside opt-in regions', () => {
    setRegion('row');
    render(<CookieConsentBanner enabled />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => openCookieSettings());

    expect(switchFor('analytics')).toBeChecked();
    expect(switchFor('marketing')).toBeChecked();
  });

  it('closes on a choice the browser refuses to store', async () => {
    // The browser keeps no cookies (blocked for the site). The refused choice lives in
    // module memory for the rest of the page, so this test starts a fresh one.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => undefined,
    });
    try {
      vi.resetModules();
      const { CookieConsentBanner: Banner } = await import('./CookieConsentBanner');
      render(<Banner enabled />);

      fireEvent.click(screen.getByRole('button', { name: 'cookieConsent.reject' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(document, 'cookie');
    }
  });

  describe('inside an iframe', () => {
    beforeEach(() => {
      vi.stubGlobal('top', {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('does not open by itself, only from Cookie settings', () => {
      setRegion('eea');
      render(<CookieConsentBanner enabled />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      act(() => openCookieSettings());
      fireEvent.click(screen.getByRole('button', { name: 'cookieConsent.reject' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(savedConsent()).toEqual(consentForCategories({ analytics: false, marketing: false }));
    });
  });

  describe('inside the mobile app', () => {
    beforeEach(() => {
      vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 TeableMobile/1.4.0'
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('never shows the banner, not even from Cookie settings', () => {
      setRegion('eea');
      render(<CookieConsentBanner enabled />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      act(() => openCookieSettings());

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(savedConsent()).toBeUndefined();
    });
  });
});
