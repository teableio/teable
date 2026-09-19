const splitter =
  'adapter-table-repository-postgres/src/record/computed/ComputedStagePlanSplitter.ts';
const convergenceTest = 'insert, rematch, delete and relink converge';
const convergenceFile = 'src/computed-convergence.e2e.spec.ts';

export const mutations = [
  {
    id: 'insert-continuation-not-normalized',
    file: splitter,
    testFile: convergenceFile,
    testName: convergenceTest,
    assertionLabel: 'COMPUTED_CONVERGENCE_VALUE',
    replacements: [
      {
        before: "changeType: plan.changeType === 'insert' ? 'update' : plan.changeType,",
        after: 'changeType: plan.changeType,',
      },
    ],
  },
  {
    id: 'deferred-dirty-seeds-dropped',
    file: splitter,
    testFile: convergenceFile,
    testName: convergenceTest,
    assertionLabel: 'COMPUTED_CONVERGENCE_VALUE',
    replacements: [
      {
        before: 'for (const group of params.dirtySeedGroups) appendExtraSeeds(group);',
        after: 'for (const group of params.dirtySeedGroups.slice(0, 0)) appendExtraSeeds(group);',
      },
    ],
  },
  {
    id: 'deferred-first-step-dropped',
    file: splitter,
    testFile: convergenceFile,
    testName: convergenceTest,
    assertionLabel: 'COMPUTED_CONVERGENCE_VALUE',
    replacements: [
      { before: 'steps: deferred.steps,', after: 'steps: deferred.steps.slice(1),' },
      {
        before: 'sameTableBatches: deferred.sameTableBatches,',
        after:
          'sameTableBatches: splitSameTableBatches(deferred.sameTableBatches, collectRetainedFieldsByStepKey(deferred.steps.slice(1))),',
      },
    ],
  },
  {
    id: 'frontier-sources-retired-before-deferred-edges',
    file: 'adapter-table-repository-postgres/src/record/computed/ComputedStageLedger.ts',
    testFile: 'src/computed-stage-budget.e2e.spec.ts',
    testName: 'reaches targets only later edge chunks touch, across partial batches (AJ shape)',
    assertionLabel: 'COMPUTED_DEFERRED_EDGE_VALUE',
    replacements: [
      {
        before: 'if (options?.preserveAsConsumed) {',
        after: 'if (false && options?.preserveAsConsumed) {',
      },
    ],
  },
  {
    id: 'deferred-same-table-ledger-seeds-dropped',
    file: 'adapter-table-repository-postgres/src/record/computed/worker/ComputedUpdateWorker.ts',
    testFile: convergenceFile,
    testName: 'retains pending same-table seeds after sibling ledger stages',
    assertionLabel: 'COMPUTED_CONVERGENCE_VALUE',
    replacements: [
      {
        before: '...finalSplit.deferred.steps.map(',
        after: '...finalSplit.deferred.steps.slice(0, 0).map(',
      },
    ],
  },
  {
    id: 'partial-stage-boundary-expanded',
    file: 'adapter-table-repository-postgres/src/record/computed/worker/ComputedUpdateWorker.ts',
    testFile: convergenceFile,
    testName: convergenceTest,
    assertionLabel: 'COMPUTED_CONVERGENCE_VALUE',
    replacements: [
      {
        before: 'if (plan.partialStageBudget) {',
        after: 'if (false && plan.partialStageBudget) {',
      },
    ],
  },
  {
    id: 'deleted-seeds-replaced-by-full-scan',
    file: splitter,
    testFile: convergenceFile,
    testName: convergenceTest,
    assertionLabel: 'COMPUTED_CONVERGENCE_VALUE',
    replacements: [
      {
        before: 'if (seedAllByKey.has(seedTableKey) && plan.beforeImageRecords?.length) {',
        after: 'if (false && seedAllByKey.has(seedTableKey) && plan.beforeImageRecords?.length) {',
      },
    ],
  },
];

export const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const transformMutation = (source, mutation) => {
  let transformed = source;
  for (const { before, after } of mutation.replacements) {
    const matches = transformed.split(before).length - 1;
    if (matches !== 1) {
      throw new Error(
        `${mutation.id}: expected exactly one source match, found ${matches}: ${before}`
      );
    }
    transformed = transformed.replace(before, after);
  }
  return transformed;
};
