import { inRange } from './range';

interface IScrollbarMetrics {
  track: number;
  content: number;
  offset: number;
  thickness: number;
  minThumb: number;
}

// How far around an 8px thumb a finger still grabs it
export const THUMB_TOUCH_SLOP = 20;

// Scroll per pixel of finger travel for a touch that grabs the thumb, or null when it misses.
// `along` is measured from the track's start, `across` from the scrollbar's outer edge.
export const getThumbDragRatio = (
  { track, content, offset, thickness, minThumb }: IScrollbarMetrics,
  along: number,
  across: number
): number | null => {
  if (thickness <= 0) return null;
  const thumb = Math.min(track, Math.max(minThumb, (track * track) / content));
  const travel = track - thumb;
  if (travel <= 0) return null;
  const thumbStart = (offset / (content - track)) * travel;
  const onThumb = inRange(
    along,
    thumbStart - THUMB_TOUCH_SLOP,
    thumbStart + thumb + THUMB_TOUCH_SLOP
  );
  const nearBar = inRange(across, -THUMB_TOUCH_SLOP, thickness + THUMB_TOUCH_SLOP);
  return onThumb && nearBar ? (content - track) / travel : null;
};
