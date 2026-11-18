export type IReferrerVia = 'x' | 'linkedin' | 'other';

const matches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * Which social site a visit came from, read off the referrer: shared links carry no parameters.
 * X wraps links in t.co and LinkedIn in lnkd.in; a redirect keeps the original referrer.
 */
export const referrerVia = (referrer: string | undefined): IReferrerVia => {
  let host: string;
  try {
    host = new URL(referrer ?? '').hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (['t.co', 'x.com', 'twitter.com'].some((domain) => matches(host, domain))) return 'x';
  if (['linkedin.com', 'lnkd.in'].some((domain) => matches(host, domain))) return 'linkedin';
  return 'other';
};

/** A visit from outside the app: none from its own pages, and none inside a frame. */
export const isOutsideVisit = (referrer: string, origin: string, framed: boolean): boolean => {
  if (framed) return false;
  if (!referrer) return true;
  try {
    return new URL(referrer).origin !== origin;
  } catch {
    return true;
  }
};
