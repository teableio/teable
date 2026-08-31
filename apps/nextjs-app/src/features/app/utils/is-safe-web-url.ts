/**
 * Whether a URL is safe to render as a clickable link: http(s) only.
 *
 * zod's `.url()` merely requires `new URL()` to parse, which lets
 * `javascript:` / `data:` / `vbscript:` through — and an OAuth app's homepage
 * is attacker-supplied input shown on pages we actively send users to.
 * Anything else should be rendered as plain text, not an anchor.
 */
export function isSafeWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
