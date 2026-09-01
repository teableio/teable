/**
 * Signup attribution (`utm_*` / ad click ids) constants — the single source
 * of truth for every writer and reader of the cookie across the monorepo
 * (Next proxy, NestJS middleware, analytics listeners), same contract style
 * as the affiliate cookie (see ./affiliate.ts).
 *
 * Why a first-party cookie instead of trusting posthog-js's native
 * `$initial_utm_*` person properties: those live on the browser's anonymous
 * person, which historically failed to merge into the signed-up person (the
 * `$identify('anonymous')` bug), and they never exist at all for OAuth/SSO
 * signups that bounce through a provider. The cookie → CLS → refMeta chain
 * survives both, server-side.
 */

export const SIGNUP_ATTRIBUTION_COOKIE_NAME = 'teable_attribution';

/** 90 days — matches the client-side marketing-attribution localStorage TTL. */
export const SIGNUP_ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

/** Cap applied per value wherever attribution is written or ingested. */
export const SIGNUP_ATTRIBUTION_VALUE_MAX_LENGTH = 500;

/**
 * Aggregate cap for the cookie payload, measured on the PERCENT-ENCODED
 * serialized value — what the Set-Cookie header actually carries. Character
 * counts lie: 500 CJK characters are ~500 JSON chars but >4.5 KB once
 * encoded, and an oversized Set-Cookie is dropped WHOLE, losing attribution
 * for exactly the long-parameter campaigns it matters for. 3000 leaves room
 * for the cookie name + attributes under the ~4 KB browser ceiling; shed
 * low-priority keys instead of truncating values.
 */
export const SIGNUP_ATTRIBUTION_COOKIE_MAX_PAYLOAD_LENGTH = 3000;

/**
 * Order in which params are KEPT when the aggregate cap forces shedding —
 * click ids first (they drive ad-platform conversion matching and are
 * useless truncated), then the coarse utm dimensions, then long-tail labels.
 */
export const SIGNUP_ATTRIBUTION_PRIORITY: readonly ISignupAttributionParamKey[] = [
  'gclid',
  'fbclid',
  'gbraid',
  'wbraid',
  'oppref',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'ref',
  'utm_term',
  'utm_content',
  'cta_id',
  'landing_cta_id',
];

/**
 * URL params worth persisting at first touch. Superset shared with the EE
 * checkout attribution (`MARKETING_ATTRIBUTION_PARAM_KEYS`) minus
 * `ga_client_id` (not a URL param), plus `fbclid` (Meta click id — the pixel
 * would persist it as `_fbc` only where the pixel runs; capturing it
 * ourselves keeps attribution working pixel-free and on pixel-blocked
 * browsers).
 */
export const SIGNUP_ATTRIBUTION_PARAM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'cta_id',
  'landing_cta_id',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'oppref',
] as const;

export type ISignupAttributionParamKey = (typeof SIGNUP_ATTRIBUTION_PARAM_KEYS)[number];

export type ISignupAttributionParams = Partial<Record<ISignupAttributionParamKey, string>>;

/** Meta pixel first-party cookies, forwarded (never written) by our stack. */
export const META_PIXEL_FBP_COOKIE = '_fbp';
export const META_PIXEL_FBC_COOKIE = '_fbc';

/**
 * Whitelist + trim + cap attribution params from any key-value source
 * (URLSearchParams, a parsed cookie payload, a parsed query string).
 * Returns only the keys that carry a non-empty value.
 */
export const pickSignupAttributionParams = (
  get: (key: ISignupAttributionParamKey) => string | null | undefined
): ISignupAttributionParams => {
  const params: ISignupAttributionParams = {};
  for (const key of SIGNUP_ATTRIBUTION_PARAM_KEYS) {
    const value = get(key)?.trim().slice(0, SIGNUP_ATTRIBUTION_VALUE_MAX_LENGTH);
    if (value) {
      params[key] = value;
    }
  }
  return params;
};

/**
 * Enforce the aggregate payload cap: keep params in priority order until the
 * serialized JSON would cross the limit, shed the rest. Deterministic and
 * whole-key — a truncated click id is worse than a missing label.
 */
export const capSignupAttributionParams = (
  params: ISignupAttributionParams
): ISignupAttributionParams => {
  const kept: ISignupAttributionParams = {};
  for (const key of SIGNUP_ATTRIBUTION_PRIORITY) {
    const value = params[key];
    if (value === undefined) {
      continue;
    }
    const candidate = { ...kept, [key]: value };
    // Measure what the header will actually carry (encoded), not raw chars.
    if (
      encodeURIComponent(JSON.stringify(candidate)).length >
      SIGNUP_ATTRIBUTION_COOKIE_MAX_PAYLOAD_LENGTH
    ) {
      continue;
    }
    kept[key] = value;
  }
  return kept;
};

/** What account creation snapshots into `user.refMeta.attribution` (minus `via`). */
export interface ISignupAttribution {
  params?: ISignupAttributionParams;
  fbp?: string;
  fbc?: string;
}

/**
 * Reads signup attribution out of a parsed cookie jar: our first-touch param
 * cookie plus the Meta pixel's own cookies. Defensive by contract — a
 * malformed cookie yields `undefined`, never a throw (this runs in request
 * middleware). Returns `undefined` when there is nothing to attribute.
 */
export const parseSignupAttributionCookies = (
  cookies: Partial<Record<string, string>>
): ISignupAttribution | undefined => {
  let params: ISignupAttributionParams | undefined;
  const raw = cookies[SIGNUP_ATTRIBUTION_COOKIE_NAME];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown> | null;
      const picked = pickSignupAttributionParams((key) => {
        const value = parsed?.[key];
        return typeof value === 'string' ? value : undefined;
      });
      if (Object.keys(picked).length) {
        params = picked;
      }
    } catch {
      // Malformed cookie — attribution is best-effort, never fatal.
    }
  }
  const fbp =
    cookies[META_PIXEL_FBP_COOKIE]?.trim().slice(0, SIGNUP_ATTRIBUTION_VALUE_MAX_LENGTH) ||
    undefined;
  const fbc =
    cookies[META_PIXEL_FBC_COOKIE]?.trim().slice(0, SIGNUP_ATTRIBUTION_VALUE_MAX_LENGTH) ||
    undefined;
  if (!params && !fbp && !fbc) {
    return undefined;
  }
  return { ...(params ? { params } : {}), ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}) };
};

/**
 * Marketing-consent cookie planted by the marketing site's banner on the
 * parent domain (`.teable.ai` / `.teable.cn`), so the app backend can read
 * the visitor's choice. Payload: percent-encoded JSON of Consent Mode
 * categories ({ ad_storage: 'granted' | 'denied', ... }).
 */
export const MARKETING_CONSENT_COOKIE_NAME = 'teable_consent';

export type MarketingAdConsent = 'granted' | 'denied';

/**
 * `ad_storage` choice from the banner cookie; `undefined` = no banner choice
 * recorded (direct-to-app visitor). Defensive by contract — malformed cookies
 * yield `undefined`, never a throw (this runs in request middleware).
 */
export const parseMarketingAdConsent = (
  cookies: Partial<Record<string, string>>
): MarketingAdConsent | undefined => {
  const raw = cookies[MARKETING_CONSENT_COOKIE_NAME];
  if (!raw) {
    return undefined;
  }
  let parsed: Record<string, unknown> | null = null;
  // cookie.parse already percent-decodes once; decode again only as fallback
  // for double-encoded writers.
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(decodeURIComponent(raw));
    } catch {
      return undefined;
    }
  }
  const value = parsed?.ad_storage;
  return value === 'granted' || value === 'denied' ? value : undefined;
};
