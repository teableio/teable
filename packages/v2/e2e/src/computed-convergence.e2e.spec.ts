import { describe, it } from 'vitest';
import { createConvergenceHarness, executionProfiles } from './shared/computedConvergence';
import {
  runConvergenceScenario,
  runSelfLinkScenario,
  type ConvergenceScenario,
} from './shared/computedConvergenceScenario';

const sequence: ConvergenceScenario = {
  depth: 3,
  fanout: 4,
  initial: [{ slot: 0, key: 'B', label: 'Beta', amount: 7 }],
  operations: [
    { kind: 'put', source: { slot: 1, key: 'A', label: 'Alpha', amount: 3 } },
    { kind: 'drain' },
    { kind: 'put', source: { slot: 2, key: 'A', label: 'Gamma', amount: 5 } },
    { kind: 'drain' },
    // Rename changes one branch only; amount unchanged must not suppress the name branch.
    { kind: 'put', source: { slot: 1, key: 'A', label: 'Alpha-renamed', amount: 3 } },
    { kind: 'drain' },
    // Multiple source states and a target relink occur before any worker drain.
    { kind: 'put', source: { slot: 1, key: 'X', label: 'Alpha-renamed', amount: 3 } },
    { kind: 'put', source: { slot: 1, key: 'B', label: 'Alpha-renamed', amount: 11 } },
    { kind: 'relink', order: 1 },
    { kind: 'drain' },
    { kind: 'delete', slot: 2 },
    { kind: 'drain' },
    { kind: 'put', source: { slot: 2, key: 'A', label: '', amount: 0 } },
    { kind: 'relink', order: null },
    { kind: 'drain' },
    { kind: 'put', source: { slot: 2, key: 'A', label: 'Restored', amount: -2 } },
    { kind: 'relink', order: 0 },
    { kind: 'drain' },
    // A no-op raw edit and an ordinary second edit catch damaged continuations.
    { kind: 'put', source: { slot: 2, key: 'A', label: 'Restored', amount: -2 } },
    { kind: 'put', source: { slot: 2, key: 'A', label: 'Final', amount: 13 } },
  ],
};

describe.each(executionProfiles)('computed convergence / $name', (profile) => {
  it('insert, rematch, delete and relink converge against independent values', async () => {
    const harness = await createConvergenceHarness(profile);
    try {
      await runConvergenceScenario(harness, sequence);
    } finally {
      await harness.close();
    }
  }, 240_000);

  it('self-link fan-out and deeper unaffected rows converge', async () => {
    const harness = await createConvergenceHarness(profile);
    try {
      await runSelfLinkScenario(harness);
    } finally {
      await harness.close();
    }
  }, 120_000);
});

// Seed 7152 shrank to this: a sibling stage consumes Peer rows without computing
// them; Peer has only same-record work left and therefore no outgoing edge.
it('retains pending same-table seeds after sibling ledger stages', async () => {
  const profile = executionProfiles.find((profile) => profile.name === 'ledger-spill');
  if (!profile) throw new Error('Missing ledger-spill profile');
  const harness = await createConvergenceHarness(profile);
  try {
    await runConvergenceScenario(harness, {
      depth: 1,
      fanout: 2,
      initial: [{ slot: 0, key: 'A', label: '0-0', amount: 0 }],
      operations: [],
    });
  } finally {
    await harness.close();
  }
}, 120_000);
