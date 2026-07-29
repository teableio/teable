import { describe, expect, it } from 'vitest';
import { computeNextWindowQuery, INITIAL_LOAD_PAGE_SIZE, LOAD_PAGE_SIZE } from './record-window';

describe('computeNextWindowQuery', () => {
  it('keeps the initial window while a normal viewport rests at the top', () => {
    // 1080p/1440p viewports (~28-40 rows) fit inside the initial 100-row window
    for (const height of [20, 28, 40]) {
      expect(
        computeNextWindowQuery({ skip: 0, take: INITIAL_LOAD_PAGE_SIZE }, 0, height)
      ).toBeNull();
    }
  });

  it('upgrades to a full window when the viewport is taller than the initial one', () => {
    // 4K / zoomed-out viewports exceed the initial window without any scroll
    for (const height of [70, 95, 99]) {
      expect(computeNextWindowQuery({ skip: 0, take: INITIAL_LOAD_PAGE_SIZE }, 0, height)).toEqual({
        skip: 0,
        take: LOAD_PAGE_SIZE,
      });
    }
  });

  it('upgrades to a full window on the first scroll out of the initial window', () => {
    const next = computeNextWindowQuery({ skip: 0, take: INITIAL_LOAD_PAGE_SIZE }, 80, 30);
    expect(next).toEqual({ skip: 0, take: LOAD_PAGE_SIZE });
  });

  it('skips whole undefined windows untouched', () => {
    expect(computeNextWindowQuery({ take: INITIAL_LOAD_PAGE_SIZE }, 500, 30)).toBeNull();
  });

  it('respects an explicit full take from the caller', () => {
    expect(computeNextWindowQuery({ skip: 0, take: 60 }, 100, 30, 60)).toEqual({
      skip: 80,
      take: 60,
    });
  });

  it('always lands the viewport inside the new window in a single step, with integer skip', () => {
    // scroll down then back up in uneven steps across realistic viewport heights
    const ys: number[] = [];
    for (let y = 0; y <= 3000; y += 7) ys.push(y);
    for (let y = 3000; y >= 0; y -= 13) ys.push(Math.max(0, y));

    for (const height of [28, 40, 65, 95]) {
      let cv: { skip: number; take: number } = { skip: 0, take: INITIAL_LOAD_PAGE_SIZE };
      for (const y of ys) {
        const next = computeNextWindowQuery(cv, y, height);
        if (next) {
          cv = next;
          expect(Number.isInteger(cv.skip)).toBe(true);
          // idempotent: recomputing for the same viewport never yields a
          // different window (near window edges it may re-yield the same one —
          // legacy behavior, deduped upstream)
          expect(computeNextWindowQuery(cv, y, height) ?? cv).toEqual(cv);
        }
        expect(cv.skip).toBeLessThanOrEqual(y);
        expect(cv.skip + cv.take).toBeGreaterThanOrEqual(y + height);
      }
    }
  });

  it('produces the same window sequence as a permanently full-size window after the upgrade', () => {
    const collect = (initialTake: number) => {
      const fetches: { skip: number; take: number }[] = [];
      let cv: { skip: number; take: number } = { skip: 0, take: initialTake };
      for (let y = 0; y <= 2000; y += 11) {
        const next = computeNextWindowQuery(cv, y, 40);
        if (next) {
          cv = next;
          fetches.push(next);
        }
      }
      return fetches;
    };

    const upgraded = collect(INITIAL_LOAD_PAGE_SIZE);
    const legacy = collect(LOAD_PAGE_SIZE);
    // the upgraded run has exactly one extra leading fetch (the upgrade itself)
    expect(upgraded.slice(1)).toEqual(legacy);
    expect(upgraded[0]).toEqual({ skip: 0, take: LOAD_PAGE_SIZE });
  });
});
