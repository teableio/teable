export const REDACTED = '[REDACTED]';

// Query parameters whose values are credentials or one-time secrets: OAuth
// codes/tokens, signed-URL signatures, API keys, share passwords, ...
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'signature',
  'sig',
  'key',
  'api_key',
  'apikey',
  'password',
  'secret',
  'client_secret',
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
]);

// Also catch camelCase / prefixed variants such as `accessToken`, `inviteToken`
// or `sharePassword`.
const SENSITIVE_QUERY_KEY_SUFFIX = /(?:token|secret|password|signature)$/i;

export const isSensitiveQueryKey = (key: string): boolean => {
  const normalized = key.trim().toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(normalized) || SENSITIVE_QUERY_KEY_SUFFIX.test(normalized);
};

const decodeKey = (rawKey: string): string => {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    return rawKey;
  }
};

/**
 * Replaces the values of sensitive query parameters with `[REDACTED]` while
 * keeping the path, the parameter names, their order and every other value
 * untouched, so access logs stay useful without leaking credentials.
 */
export const redactUrl = (url: string): string => {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const hashStart = url.indexOf('#', queryStart);
  const queryEnd = hashStart === -1 ? url.length : hashStart;
  const query = url.slice(queryStart + 1, queryEnd);
  if (!query) return url;

  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const rawKey = pair.slice(0, eq);
      return isSensitiveQueryKey(decodeKey(rawKey)) ? `${rawKey}=${REDACTED}` : pair;
    })
    .join('&');

  return `${url.slice(0, queryStart + 1)}${redacted}${url.slice(queryEnd)}`;
};

/** Same as {@link redactUrl} for an already-parsed query object. */
export const redactQuery = <T>(query: T): T => {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return query;
  return Object.fromEntries(
    Object.entries(query as Record<string, unknown>).map(([key, value]) => [
      key,
      isSensitiveQueryKey(key) ? REDACTED : value,
    ])
  ) as T;
};

const SENSITIVE_FIELDS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'clientSecret',
  'apiKey',
  'authorization',
  'cookie',
];

/**
 * pino `redact` paths: a backstop for credentials that end up in a log object
 * (request headers if they are ever kept, axios errors, or a field passed
 * straight to logger.info({ ... }) at the top level or one level deep, e.g.
 * `{ body: { password } }`). pino-http never logs request bodies.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'err.config.headers.Authorization',
  'err.config.headers.authorization',
  'err.config.headers.Cookie',
  'err.config.headers.cookie',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`]),
];
