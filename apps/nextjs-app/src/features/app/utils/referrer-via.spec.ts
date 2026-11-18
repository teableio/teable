import { describe, expect, it } from 'vitest';
import { isOutsideVisit, referrerVia } from './referrer-via';

describe('referrerVia', () => {
  it.each([
    ['https://t.co/', 'x'],
    ['https://x.com/maya/status/1', 'x'],
    ['https://mobile.twitter.com/', 'x'],
    ['https://www.linkedin.com/', 'linkedin'],
    ['https://lnkd.in/abc', 'linkedin'],
    ['https://news.ycombinator.com/', 'other'],
    ['https://notx.com/', 'other'],
    ['', 'other'],
    [undefined, 'other'],
    ['not a url', 'other'],
  ] as const)('%s → %s', (referrer, via) => {
    expect(referrerVia(referrer)).toBe(via);
  });
});

describe('isOutsideVisit', () => {
  const origin = 'https://app.teable.ai';

  it('counts a visit from another site or with no referrer', () => {
    expect(isOutsideVisit('https://t.co/', origin, false)).toBe(true);
    expect(isOutsideVisit('', origin, false)).toBe(true);
  });

  it('leaves out the app itself and framed previews', () => {
    expect(isOutsideVisit('https://app.teable.ai/space/spc1', origin, false)).toBe(false);
    expect(isOutsideVisit('https://t.co/', origin, true)).toBe(false);
  });
});
