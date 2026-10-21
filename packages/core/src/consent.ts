/**
 * Cookie-consent model shared by the marketing site and the app.
 *
 * Opt-in jurisdictions (GDPR / ePrivacy family): EU 27 + EEA (IS/LI/NO) +
 * UK + CH. Visitors there get the consent banner and non-essential storage
 * stays off until they accept. Everywhere else consent law is opt-out, so
 * tracking defaults to granted and the banner is skipped (an explicit
 * "Reject all" from the Cookie settings dialog is still honoured).
 *
 * Mirrors teable-official src/lib/consent-region.ts — keep the country list
 * in sync. Unknown origin (no geo header) falls back to opt-in.
 */
export const CONSENT_REGION_COOKIE_NAME = 'teable_consent_region';

export type ConsentRegion = 'eea' | 'row';

const OPT_IN_CONSENT_COUNTRIES = new Set([
  // EU 27
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  // EEA
  'IS',
  'LI',
  'NO',
  // UK + Switzerland (UK GDPR / revFADP)
  'GB',
  'CH',
]);

export const consentRegionForCountry = (country: string | null | undefined): ConsentRegion =>
  !country || OPT_IN_CONSENT_COUNTRIES.has(country.trim().toUpperCase()) ? 'eea' : 'row';

/**
 * ISO country code from a geo header (Cloudflare `cf-ipcountry`), or
 * undefined when the origin is unknown — including Cloudflare's `XX`
 * (unknown) and `T1` (Tor) placeholders.
 */
export const normalizeCountryCode = (country: string | null | undefined): string | undefined => {
  const code = country?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : undefined;
};

/** What a server-side ad conversion's consent signal is derived from. */
export interface IAdConversionConsent {
  /** Banner ad consent (`MarketingAdConsent`); any other value = no choice. */
  consent?: string | null;
  /** Visitor's country (cf-ipcountry) as of the consent snapshot. */
  country?: string | null;
}

/** Google's consent signal values (Google Ads API / GA4 Measurement Protocol). */
export type AdUserDataConsent = 'GRANTED' | 'DENIED';

/**
 * The one rule for the consent signal the backend attaches to conversions it
 * sends straight to Google (Google Ads, GA4 Measurement Protocol). DENIED on
 * an explicit denial, or with no choice recorded for a visitor in the opt-in
 * region as the banner decides it (EEA/UK/CH, or no country at all). GRANTED
 * otherwise, including Cloudflare's XX/T1 placeholders, which the banner also
 * treats as outside the opt-in region. The conversion is sent either way;
 * DENIED only strips user identifiers.
 */
export const adUserDataConsent = ({
  consent,
  country,
}: IAdConversionConsent): AdUserDataConsent => {
  if (consent === 'granted') {
    return 'GRANTED';
  }
  if (consent === 'denied') {
    return 'DENIED';
  }
  // Same region rule as the banner (consentRegionForCountry): no country at all counts as
  // opt-in, so a visitor who was shown the banner and never answered is not reported as GRANTED.
  return consentRegionForCountry(country) === 'eea' ? 'DENIED' : 'GRANTED';
};

export type ConsentStatus = 'granted' | 'denied';

// Keys are Google Consent Mode's category names, shared with the marketing
// site's cookie payload — not ours to rename.
/* eslint-disable @typescript-eslint/naming-convention */
export interface IMarketingConsent {
  analytics_storage: ConsentStatus;
  ad_storage: ConsentStatus;
  ad_user_data: ConsentStatus;
  ad_personalization: ConsentStatus;
}
/* eslint-enable @typescript-eslint/naming-convention */

/** One year: consent is re-asked after this, per EDPB/CNIL guidance. */
export const MARKETING_CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Recorded with every consent event so a choice can be tied to the text shown. */
export const CONSENT_BANNER_VERSION = '2026-10b';

/** How a choice was made, recorded alongside it. */
export type ConsentMethod = 'accept_all' | 'reject_all' | 'custom';

export const allConsent = (status: ConsentStatus): IMarketingConsent => ({
  analytics_storage: status,
  ad_storage: status,
  ad_user_data: status,
  ad_personalization: status,
});

/**
 * Builds a choice from the banner's per-category switches. Marketing covers
 * all three ad signals: they are only ever granted or denied together.
 */
export const consentForCategories = ({
  analytics,
  marketing,
}: {
  analytics: boolean;
  marketing: boolean;
}): IMarketingConsent => {
  const status = (granted: boolean): ConsentStatus => (granted ? 'granted' : 'denied');
  return {
    analytics_storage: status(analytics),
    ad_storage: status(marketing),
    ad_user_data: status(marketing),
    ad_personalization: status(marketing),
  };
};

const isStatus = (value: unknown): value is ConsentStatus =>
  value === 'granted' || value === 'denied';

/**
 * Parses the `teable_consent` cookie value (percent-encoded JSON, possibly
 * double-encoded by older writers). Returns undefined when no valid choice
 * is recorded — never throws.
 */
export const parseMarketingConsent = (
  raw: string | null | undefined
): Partial<IMarketingConsent> | undefined => {
  if (!raw) {
    return undefined;
  }
  let parsed: Record<string, unknown> | null = null;
  for (const candidate of [raw, safeDecode(raw), safeDecode(safeDecode(raw))]) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // try the next decoding
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const result: Partial<IMarketingConsent> = {};
  for (const key of [
    'analytics_storage',
    'ad_storage',
    'ad_user_data',
    'ad_personalization',
  ] as const) {
    const value = parsed[key];
    if (isStatus(value)) {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Whether a category may use non-essential storage: opt-out regions default
 * to granted unless explicitly denied; opt-in regions need an explicit grant.
 */
export const isConsentGranted = (
  region: ConsentRegion,
  consent: Partial<IMarketingConsent> | undefined,
  category: keyof IMarketingConsent
): boolean =>
  region === 'row' ? consent?.[category] !== 'denied' : consent?.[category] === 'granted';
