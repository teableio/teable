import { ArrowRight } from '@teable/icons';
import * as React from 'react';
import { cn } from '../../shadcn';

/**
 * The separator in a "click here, then here" path — `Basic Information → App
 * Credentials`.
 *
 * It exists so that arrow does not live inside a translated string. A literal
 * `→` is not bidi-mirrored, so in a right-to-left interface it keeps pointing
 * right no matter which way the sentence reads, and whether that is correct
 * depends on the arrow's resolved bidi embedding level — a judgement every
 * translator would otherwise have to make, per string, in twelve languages.
 * Rendering it as an icon moves the decision to `[data-rtl-flip]:dir(rtl)`,
 * which resolves the *computed* direction and therefore also stays correct
 * inside the grid, which pins itself back to `dir="ltr"`.
 *
 * Pass it to `<Trans>` as the `sep` component and write `<sep/>` in the locale
 * string, so translators see a separator token instead of a glyph they have to
 * reason about.
 *
 * `ArrowRight` rather than a chevron, so it still reads as the arrow the copy
 * used to spell out. Swapping the icon is a one-line change here and touches no
 * translation — which is the point of holding the separator in a component.
 */
export const PathArrow = (props: { className?: string }) => (
  <ArrowRight
    aria-hidden
    className={cn('mx-1 inline size-3.5 shrink-0 align-[-0.15em]', props.className)}
  />
);
