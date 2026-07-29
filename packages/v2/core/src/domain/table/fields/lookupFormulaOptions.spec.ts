import { describe, expect, it } from 'vitest';

import { inferLookupDisplayOptionsPatch } from './lookupFormulaOptions';

describe('inferLookupDisplayOptionsPatch', () => {
  it('drops display options mirrored from the source field', () => {
    const formatting = { type: 'currency', precision: 1, symbol: '$' };

    expect(
      inferLookupDisplayOptionsPatch(
        { formatting, showAs: { type: 'url' } },
        { formatting, showAs: { type: 'url' } }
      )
    ).toBeUndefined();
  });

  it('keeps display options that override the source field', () => {
    expect(
      inferLookupDisplayOptionsPatch(
        { formatting: { type: 'currency', precision: 0, symbol: '$' } },
        { formatting: { type: 'decimal', precision: 2 } }
      )
    ).toEqual({ formatting: { type: 'currency', precision: 0, symbol: '$' } });
  });

  it('keeps null tombstones even when the source option is absent', () => {
    expect(inferLookupDisplayOptionsPatch({ showAs: null }, {})).toEqual({ showAs: null });
  });
});
