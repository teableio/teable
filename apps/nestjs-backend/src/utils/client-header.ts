/**
 * `X-Teable-Client: <name>/<version>` identifies first-party non-browser clients (the
 * mobile app sends `mobile/<app version>` on every request). Browsers never send it, so it
 * is a cleaner signal than the user agent for logs, audit rows and sessions.
 */
export interface IClientHeader {
  name: string;
  version: string;
}

const CLIENT_HEADER_RE = /^([a-z][a-z0-9-]{0,31})\/([0-9A-Za-z.+-]{1,32})$/;

export const parseClientHeader = (
  value: string | string[] | undefined
): IClientHeader | undefined => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  const match = raw ? CLIENT_HEADER_RE.exec(raw) : null;
  return match ? { name: match[1], version: match[2] } : undefined;
};

/** Canonical `name/version` string, or undefined for missing / malformed headers. */
export const formatClientHeader = (value: string | string[] | undefined): string | undefined => {
  const parsed = parseClientHeader(value);
  return parsed && `${parsed.name}/${parsed.version}`;
};
