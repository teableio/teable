import { describe, expect, it } from 'vitest';

import {
  chooseSearchAccessPathValidationNextAction,
  type SearchAccessPathValidationSample,
} from './searchVectorValidation';

const sample = (
  overrides: Partial<SearchAccessPathValidationSample> = {}
): SearchAccessPathValidationSample => ({
  legacyPath: { medianMs: 20, p95Ms: 25 },
  candidatePath: { medianMs: 5, p95Ms: 8 },
  exactResultMatch: true,
  planEvidence: {
    explainStatus: 'validated',
    costBefore: 100,
    costAfter: 10,
    usesGinIndex: true,
    ginExpected: true,
  },
  ...overrides,
});

describe('chooseSearchAccessPathValidationNextAction', () => {
  it('requires plan validation when an expected GIN plan was not validated', () => {
    expect(
      chooseSearchAccessPathValidationNextAction([
        sample({
          planEvidence: {
            explainStatus: 'failed',
            usesGinIndex: false,
            ginExpected: true,
          },
        }),
      ])
    ).toBe('needs_plan_validation');
  });

  it('never confirms a candidate with a different complete result set', () => {
    expect(chooseSearchAccessPathValidationNextAction([sample({ exactResultMatch: false })])).toBe(
      'manual_investigation'
    );
  });

  it('keeps a materially slower candidate out of the execution path', () => {
    expect(
      chooseSearchAccessPathValidationNextAction([
        sample({ candidatePath: { medianMs: 30, p95Ms: 35 } }),
      ])
    ).toBe('manual_investigation');
  });

  it('accepts exact results with a cheaper real GIN plan and stable timings', () => {
    expect(chooseSearchAccessPathValidationNextAction([sample()])).toBe('ready_for_confirmation');
  });

  it('allows a short-probe fallback when another selective probe proves the index', () => {
    expect(
      chooseSearchAccessPathValidationNextAction([
        sample({
          legacyPath: { medianMs: 3, p95Ms: 4 },
          candidatePath: { medianMs: 3, p95Ms: 4 },
          planEvidence: {
            explainStatus: 'skipped',
            usesGinIndex: false,
            ginExpected: false,
          },
        }),
        sample(),
      ])
    ).toBe('ready_for_confirmation');
  });
});
