/**
 * Validates that a redirect path is safe to navigate to.
 * Blocks dangerous protocols (javascript:, data:, vbscript:, etc.) and cross-origin redirects.
 *
 * @param path - The redirect path to validate
 * @param origin - The trusted origin to validate against.
 *   On client: pass `window.location.origin`.
 *   On server: omit to only allow same-origin relative paths.
 */
export function isValidRedirectPath(path: string, origin?: string): boolean {
  try {
    const base = origin || 'http://placeholder.local';
    const url = new URL(path, base);
    return url.origin === base && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}
