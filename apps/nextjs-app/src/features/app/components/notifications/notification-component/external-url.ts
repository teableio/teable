/**
 * Whether a notification links outside the app (e.g. to the community forum). Those open in a
 * new tab: navigating away in place would drop the user out of whatever they were doing.
 */
export const isExternalNotificationUrl = (url: string) => {
  if (!/^https?:\/\//i.test(url)) return false;
  if (typeof window === 'undefined') return true;
  try {
    return new URL(url).origin !== window.location.origin;
  } catch {
    return false;
  }
};
