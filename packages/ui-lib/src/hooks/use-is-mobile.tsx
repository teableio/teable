import { useMediaQuery } from './use-media-query';

/**
 * @deprecated Prefer `useIsMobile` from `@teable/sdk`, which carries the
 * product-wide 640px breakpoint. This overload exists for the handful of
 * call sites that opted into a 768px cut-off.
 *
 * `deferToEffect` preserves the original behaviour of this hook (false until
 * mounted); dropping it would change the first painted frame for its callers.
 */
export function useIsMobile(mobileBreakpoint = 768) {
  // `- 0.02` rather than `- 1`: this hook used to report `innerWidth < bp`, and
  // a whole-pixel query would disagree with that at fractional viewport widths
  // (a 767.5px window is mobile under the old predicate, but not under
  // `max-width: 767px`).
  return useMediaQuery(`(max-width: ${mobileBreakpoint - 0.02}px)`, { deferToEffect: true });
}
