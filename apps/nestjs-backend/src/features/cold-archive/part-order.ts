// Read-side part ORDERING shared by every cold subsystem: which candidate part
// to open next, and when the page in hand makes the remaining ones pointless.
// Its siblings in part-scan.ts judge one part at a time; these two work over a
// month's whole candidate list and are meant to be used as a pair — the stop
// test is only sound on a list this module ordered.
//
// Both are pure functions over a part's bound accessor, so a subsystem passes
// its own part type and its own stats lookup without this module knowing either
// the row type or where the bound is recorded.

/**
 * How a page is served from a part: `boundOf` yields the part's newest row when
 * serving newest-first, its oldest when serving oldest-first. Undefined means
 * the bound is UNKNOWN — no stats entry, or a sort dimension the entry does not
 * record — never that the part is empty.
 */
export interface IServingOrder<TPart> {
  boundOf: (part: TPart) => string | undefined;
  descending: boolean;
}

/**
 * A month's listing is NOT in serving order: day parts sort ahead of month
 * parts and ascend by day, which matches a descending page only by accident.
 * Ordering by the bound the page is served from restores it, so a filled page
 * can stop the month early instead of fetching every remaining part in full.
 *
 * A part with an unknown bound sorts first and is therefore always scanned:
 * pruning may only begin once every part left carries one. Passing a boundOf
 * that always returns undefined is how a caller opts a sort dimension out —
 * the listing order survives and nothing ever prunes.
 */
export const orderPartsByServingBound = <TPart>(
  parts: TPart[],
  { boundOf, descending }: IServingOrder<TPart>
): TPart[] =>
  [...parts].sort((a, b) => {
    const left = boundOf(a);
    const right = boundOf(b);
    if (left === undefined || right === undefined) {
      return left === right ? 0 : left === undefined ? -1 : 1;
    }
    if (left === right) return 0;
    if (descending) return left < right ? 1 : -1;
    return left < right ? -1 : 1;
  });

/**
 * True once a full page's weakest row beats every row `next` could hold. One
 * comparison ends the month because `next` bounds all the parts behind it —
 * which holds only when the list came from orderPartsByServingBound with this
 * same order.
 *
 * `weakest` is the sort key of the page's last row, or undefined while the page
 * is still short of its quota. Equal keys never prune: the id half of the
 * serving key has no counterpart in the bound, so a tie may still hide a
 * stronger id.
 */
export const pageOutranksRest = <TPart>(
  weakest: string | undefined,
  next: TPart | undefined,
  { boundOf, descending }: IServingOrder<TPart>
): boolean => {
  if (weakest === undefined || !next) return false;
  const bound = boundOf(next);
  if (bound === undefined) return false;
  return descending ? weakest > bound : weakest < bound;
};
