import { describe, expect, it } from 'vitest';

import {
  chooseSearchVectorValidationNextAction,
  type SearchVectorValidationSample,
} from './searchVectorValidation';

const sample = (
  overrides: Partial<SearchVectorValidationSample> = {}
): SearchVectorValidationSample => ({
  defaultPath: { durationMs: 20 },
  generatedTsvectorPath: { durationMs: 5 },
  planEvidence: {
    explainStatus: 'validated',
    costBefore: 100,
    costAfter: 10,
    usesGinIndex: true,
    ginExpected: true,
  },
  llmReasonableness: 'reasonable',
  ...overrides,
});

describe('chooseSearchVectorValidationNextAction', () => {
  it('requires plan validation when EXPLAIN failed even for a high-match sample', () => {
    expect(
      chooseSearchVectorValidationNextAction([
        sample({
          planEvidence: {
            explainStatus: 'failed',
            usesGinIndex: false,
            ginExpected: false,
          },
        }),
      ])
    ).toBe('needs_plan_validation');
  });

  it('does not confirm a candidate whose estimated cost did not improve', () => {
    expect(
      chooseSearchVectorValidationNextAction([
        sample({
          planEvidence: {
            explainStatus: 'validated',
            costBefore: 10,
            costAfter: 20,
            usesGinIndex: true,
            ginExpected: true,
          },
        }),
      ])
    ).toBe('manual_investigation');
  });

  it('keeps semantic drift out of the execution path', () => {
    expect(
      chooseSearchVectorValidationNextAction([sample({ llmReasonableness: 'semantic_drift' })])
    ).toBe('needs_language_config');
  });

  it('confirms only validated candidates with lower plan cost and duration', () => {
    expect(chooseSearchVectorValidationNextAction([sample()])).toBe('ready_for_confirmation');
  });
});
