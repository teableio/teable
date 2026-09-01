import { useMediaQuery } from '@teable/ui-lib';

/**
 * The product-wide narrow-viewport cut-off, in pixels.
 *
 * Inclusive: a viewport of exactly 640px is mobile. This overlaps Tailwind's
 * `sm:` (min-width: 640px) by one pixel, which is why layout that must agree
 * with this hook uses `sm:` for the desktop side and unprefixed classes for
 * the mobile side rather than a `max-sm:` mirror.
 */
export const MOBILE_MAX_WIDTH = 640;

export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

export const useIsMobile = () => {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
};
