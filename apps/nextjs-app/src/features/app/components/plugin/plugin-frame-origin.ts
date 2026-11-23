/**
 * The origin a plugin frame is served from, or undefined when its url is not an
 * http(s) one. A relative url (the built-in plugins) resolves against the page.
 */
export const getPluginFrameOrigin = (src: string, pageUrl: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(src, pageUrl);
  } catch {
    return undefined;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
};
