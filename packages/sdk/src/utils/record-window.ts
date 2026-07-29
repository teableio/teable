import { inRange } from 'lodash';

export const LOAD_PAGE_SIZE = 300;
// only the very first query: keeps the initial payload small (and matches the
// server-side default take used for SSR seeding). The first failed range check
// — a scroll, or a viewport taller than this — reissues a full-size window
export const INITIAL_LOAD_PAGE_SIZE = 100;

/**
 * Sliding-window pagination shared by the async-record hooks: given the
 * currently loaded window and the visible row range, decide whether a new
 * window must be issued.
 *
 * The range check runs against the window actually loaded (which is the
 * smaller initial one before the first slide), but any newly issued window is
 * always full-size — its gap must divide `fullTake` evenly so skip stays an
 * integer.
 *
 * Returns the next `{ skip, take }` when the viewport left the loaded window,
 * or `null` when the current window still covers it.
 */
export const computeNextWindowQuery = (
  loaded: { skip?: number; take?: number },
  y: number,
  height: number,
  fullTake: number = LOAD_PAGE_SIZE
): { skip: number; take: number } | null => {
  if (loaded.skip === undefined) return null;

  const loadedTake = loaded.take ?? fullTake;
  const pageOffsetSize = loadedTake / 3;

  const visibleStartIndex =
    loaded.skip <= y ? loaded.skip - pageOffsetSize : loaded.skip + pageOffsetSize;
  const visibleEndIndex = visibleStartIndex + loadedTake;
  const viewInRange =
    inRange(y, visibleStartIndex, visibleEndIndex) &&
    inRange(y + height, visibleStartIndex, visibleEndIndex);
  if (viewInRange) return null;

  const pageGap = fullTake / 3;
  const skip = Math.floor(y / pageGap) * pageGap - pageGap;
  return { take: fullTake, skip: Math.max(0, skip) };
};
