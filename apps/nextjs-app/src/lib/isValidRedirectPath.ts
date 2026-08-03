/**
 * Validates that a redirect path is safe to navigate to.
 * Blocks dangerous protocols (javascript:, data:, vbscript:, etc.) and cross-origin redirects.
 * Automatically detects `window.location.origin` on the client; falls back to a placeholder on the server.
 */
export function isValidRedirectPath(path: string): boolean {
  try {
    const base =
      typeof window !== 'undefined' ? window.location.origin : 'http://placeholder.local';
    const url = new URL(path, base);
    return url.origin === base && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}
