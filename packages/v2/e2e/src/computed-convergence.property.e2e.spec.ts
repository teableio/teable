import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { createConvergenceHarness, executionProfiles } from './shared/computedConvergence';
import {
  runConvergenceScenario,
  type ConvergenceOperation,
  type ConvergenceScenario,
} from './shared/computedConvergenceScenario';

const source = fc
  .record({
    slot: fc.integer({ min: 0, max: 3 }),
    key: fc.constantFrom('A', 'B', 'X'),
    amount: fc.integer({ min: -20, max: 20 }),
    label: fc.integer({ min: 0, max: 20 }),
  })
  .map((input) => ({ ...input, label: `${input.slot}-${input.label}` }));
const operation: fc.Arbitrary<ConvergenceOperation> = fc.oneof(
  source.map((source) => ({ kind: 'put' as const, source })),
  fc.integer({ min: 0, max: 3 }).map((slot) => ({ kind: 'delete' as const, slot })),
  fc
    .option(fc.integer({ min: 0, max: 3 }), { nil: null })
    .map((order) => ({ kind: 'relink' as const, order })),
  fc.constant({ kind: 'drain' as const })
);
// Shrinkable schema depth/fan-out, source data and operation sequence; no implementation plans.
const scenario: fc.Arbitrary<ConvergenceScenario> = fc.record({
  depth: fc.integer({ min: 1, max: 4 }),
  fanout: fc.integer({ min: 2, max: 5 }),
  initial: fc.uniqueArray(source, {
    minLength: 1,
    maxLength: 3,
    selector: (source) => source.slot,
  }),
  operations: fc.array(operation, { minLength: 1, maxLength: 16 }),
});
const seed = Number(process.env.COMPUTED_PROPERTY_SEED ?? 7152);
const numRuns = Number(process.env.COMPUTED_PROPERTY_RUNS ?? 2);
if (!Number.isInteger(seed) || !Number.isInteger(numRuns) || numRuns < 1)
  throw new Error('Invalid computation property seed/run count');

describe.each(executionProfiles)('computed generated convergence / $name', (profile) => {
  it('shrinks legal graphs and operation sequences against independent values', async () => {
    const result = await fc.check(
      fc.asyncProperty(scenario, async (input) => {
        const harness = await createConvergenceHarness(profile);
        try {
          await runConvergenceScenario(harness, input);
        } finally {
          await harness.close();
        }
      }),
      { seed, numRuns, path: process.env.COMPUTED_PROPERTY_PATH, endOnFailure: false }
    );
    if (result.failed) {
      const failure = result.errorInstance;
      const evidence = {
        profile: profile.name,
        seed: result.seed,
        path: result.counterexamplePath,
        schemaAndOperations: result.counterexample?.[0],
        numRuns: result.numRuns,
        numShrinks: result.numShrinks,
        failure: result.error,
        values:
          failure && typeof failure === 'object' && 'actual' in failure && 'expected' in failure
            ? { actual: failure.actual, expected: failure.expected }
            : undefined,
        replay: `COMPUTED_PROFILE_SCOPE=extended COMPUTED_PROPERTY_RUNS=${numRuns} COMPUTED_PROPERTY_SEED=${result.seed} COMPUTED_PROPERTY_PATH='${result.counterexamplePath}' pnpm --filter @teable/v2-e2e exec vitest run src/computed-convergence.property.e2e.spec.ts -t 'computed generated convergence / .*${profile.name}'`,
      };
      const artifactPath = process.env.COMPUTED_PROPERTY_ARTIFACT_PATH;
      if (artifactPath) {
        mkdirSync(dirname(artifactPath), { recursive: true });
        writeFileSync(`${artifactPath}.${profile.name}.json`, JSON.stringify(evidence, null, 2));
      }
      throw new Error(JSON.stringify(evidence, null, 2));
    }
  }, 1_800_000);
});
