import { describe, expect, it } from 'vitest';
import { THUMB_TOUCH_SLOP, getThumbDragRatio } from './scrollbar';

// A 600px track over 6000px of rows: a 60px thumb with 540px to travel, 10px thick
const metrics = { track: 600, content: 6000, offset: 0, thickness: 10, minThumb: 32 };

describe('getThumbDragRatio', () => {
  it('drags the thumb proportionally when the touch lands on it', () => {
    expect(getThumbDragRatio(metrics, 30, 5)).toBe(5400 / 540);
  });

  it('grabs a thumb a finger misses by a little, on either side', () => {
    expect(getThumbDragRatio(metrics, 60 + THUMB_TOUCH_SLOP, 10 + THUMB_TOUCH_SLOP)).not.toBeNull();
    expect(getThumbDragRatio(metrics, -THUMB_TOUCH_SLOP, -THUMB_TOUCH_SLOP)).not.toBeNull();
  });

  it('leaves touches away from the thumb to the grid', () => {
    // Further down the track than the thumb sits
    expect(getThumbDragRatio(metrics, 300, 5)).toBeNull();
    // Level with the thumb, but over the cells
    expect(getThumbDragRatio(metrics, 30, 10 + THUMB_TOUCH_SLOP + 1)).toBeNull();
  });

  it('follows the thumb as the content scrolls', () => {
    const scrolled = { ...metrics, offset: 5400 };
    expect(getThumbDragRatio(scrolled, 30, 5)).toBeNull();
    expect(getThumbDragRatio(scrolled, 570, 5)).toBe(5400 / 540);
  });

  it('keeps the thumb at the minimum length of the scrollbar style', () => {
    // 600² / 60000 is a 6px thumb, drawn 32px long: 568px to travel
    expect(getThumbDragRatio({ ...metrics, content: 60000 }, 30, 5)).toBe(59400 / 568);
    // Without a floor it stays 6px: 594px to travel
    expect(getThumbDragRatio({ ...metrics, content: 60000, minThumb: 0 }, 3, 5)).toBe(59400 / 594);
  });

  it('has nothing to grab without a scrollbar that takes room, or anything to scroll', () => {
    expect(getThumbDragRatio({ ...metrics, thickness: 0 }, 30, 5)).toBeNull();
    expect(getThumbDragRatio({ ...metrics, content: 600 }, 30, 5)).toBeNull();
  });
});
