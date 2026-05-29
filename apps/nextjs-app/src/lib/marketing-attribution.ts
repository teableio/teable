const ATTRIBUTION_STORAGE_KEY = 'teable_marketing_attribution';
const ATTRIBUTION_STORAGE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ATTRIBUTION_VALUE_MAX_LENGTH = 500;

const MARKETING_ATTRIBUTION_PARAM_KEYS = [
  'via',
  'ref',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'cta_id',
  'landing_cta_id',
  'gclid',
  'gbraid',
  'wbraid',
  'ga_client_id',
] as const;

export type IMarketingAttribution = Partial<
  Record<(typeof MARKETING_ATTRIBUTION_PARAM_KEYS)[number], string>
>;

interface IStoredMarketingAttribution {
  createdAt: number;
  value: IMarketingAttribution;
}

function compactAttribution(attribution: IMarketingAttribution): IMarketingAttribution {
  return Object.fromEntries(
    Object.entries(attribution)
      .filter(([, value]) => typeof value === 'string' && value !== '')
      .map(([key, value]) => [key, value.slice(0, ATTRIBUTION_VALUE_MAX_LENGTH)])
  ) as IMarketingAttribution;
}

function hasAttribution(attribution: IMarketingAttribution) {
  return Object.keys(attribution).length > 0;
}

function readAttributionFromSearch(searchParams: URLSearchParams): IMarketingAttribution {
  const attribution: IMarketingAttribution = {};

  for (const key of MARKETING_ATTRIBUTION_PARAM_KEYS) {
    const value = searchParams.get(key);
    if (value) {
      attribution[key] = value;
    }
  }

  return attribution;
}

function readStoredAttribution(): IMarketingAttribution {
  if (typeof window === 'undefined') {
    return {};
  }

  const rawAttribution = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
  if (!rawAttribution) {
    return {};
  }

  try {
    const storedAttribution = JSON.parse(rawAttribution) as IStoredMarketingAttribution;
    if (Date.now() - storedAttribution.createdAt > ATTRIBUTION_STORAGE_TTL_MS) {
      window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
      return {};
    }

    const value = compactAttribution(storedAttribution.value ?? {});
    if (!hasAttribution(value)) {
      window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
      return {};
    }

    return value;
  } catch {
    window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
    return {};
  }
}

function readStoredAttributionWithCreatedAt(): IStoredMarketingAttribution | undefined {
  const value = readStoredAttribution();
  if (!hasAttribution(value)) {
    return undefined;
  }

  const rawAttribution = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
  if (!rawAttribution) {
    return undefined;
  }

  try {
    const storedAttribution = JSON.parse(rawAttribution) as IStoredMarketingAttribution;
    return {
      createdAt: storedAttribution.createdAt,
      value,
    };
  } catch {
    return undefined;
  }
}

function persistAttribution(attribution: IMarketingAttribution, createdAt = Date.now()) {
  if (typeof window === 'undefined' || Object.keys(attribution).length === 0) {
    return;
  }

  const storedAttribution: IStoredMarketingAttribution = {
    createdAt,
    value: attribution,
  };

  window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(storedAttribution));
}

function readCurrentAttribution(): IMarketingAttribution {
  if (typeof window === 'undefined') {
    return {};
  }

  const searchParams = new URLSearchParams(window.location.search);
  const attribution = readAttributionFromSearch(searchParams);
  const redirect = searchParams.get('redirect');

  if (!redirect) {
    return attribution;
  }

  try {
    const redirectUrl = new URL(decodeURIComponent(redirect), window.location.origin);
    return {
      ...readAttributionFromSearch(redirectUrl.searchParams),
      ...attribution,
    };
  } catch {
    return attribution;
  }
}

function readCookie(name: string) {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const cookie = document.cookie
    .split('; ')
    .find((cookiePart) => cookiePart.startsWith(`${name}=`));

  return cookie?.split('=').slice(1).join('=');
}

function readGaClientId() {
  const gaCookie = readCookie('_ga');
  const cookieParts = gaCookie?.split('.');

  if (!cookieParts || cookieParts.length < 4) {
    return undefined;
  }

  return `${cookieParts[cookieParts.length - 2]}.${cookieParts[cookieParts.length - 1]}`;
}

function enrichAttribution(attribution: IMarketingAttribution) {
  return compactAttribution({
    ga_client_id: readGaClientId(),
    ...attribution,
  });
}

export function syncMarketingAttributionFromUrl() {
  const storedAttribution = readStoredAttributionWithCreatedAt();
  const currentAttribution = readCurrentAttribution();

  if (hasAttribution(currentAttribution)) {
    persistAttribution({
      ...storedAttribution?.value,
      ...enrichAttribution(currentAttribution),
    });
    return;
  }

  if (storedAttribution) {
    persistAttribution(enrichAttribution(storedAttribution.value), storedAttribution.createdAt);
  }
}

export function getMarketingAttribution(): IMarketingAttribution {
  const storedAttribution = readStoredAttributionWithCreatedAt();
  const currentAttribution = readCurrentAttribution();
  const hasCurrentAttribution = hasAttribution(currentAttribution);
  const attribution = hasCurrentAttribution
    ? {
        ...storedAttribution?.value,
        ...enrichAttribution(currentAttribution),
      }
    : enrichAttribution(storedAttribution?.value ?? {});

  if (hasCurrentAttribution) {
    persistAttribution(attribution);
  } else if (storedAttribution) {
    persistAttribution(attribution, storedAttribution.createdAt);
  }

  return attribution;
}
