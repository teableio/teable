import { useMediaQuery } from './use-media-query';

/**
 * The device's primary pointer is a finger (a phone, a tablet without a trackpad).
 *
 * Where this holds, focusing a text field raises the software keyboard over half the
 * screen, so a list that opens with a search field leaves the field alone until it is
 * tapped — the list is what the reader came to touch.
 */
export function useIsCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
