/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7401: fanout-split amplification on a cyclic link graph.
 *
 * Production (base bse86vRbB7C8vdxra9r, run cur809hcOWIQH98KLk3) executed 926
 * tasks in 14m37s for one cascade and pushed the Aurora writer to 98% CPU. The
 * siblings of that chain carried exactly 5 seeds, which is the shipped
 * `fanoutSeedSplitMaxSeeds` default: whenever a linkTraversal-only task's dirty
 * fan-out crosses `fanoutDirtyRecordsThreshold`, the per-task seed cap collapsed
 * from maxSeedRecordsPerTask to 5 and the work was chopped into many tiny
 * children, each paying the full per-task pipeline.
 *
 * The same workload runs twice, once with the fanout split disabled and once
 * with it enabled. The disabled run is the control: it shows the task cost of the
 * cascade itself, so the enabled run's extra task executions and extra children
 * are attributable to the fanout path rather than to ordinary stage splitting.
 */
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { createConvergenceHarness, executionProfiles } from './shared/computedConvergence';

const baseProfile = executionProfiles.find((entry) => entry.name === 'ledger-spill');
if (!baseProfile) throw new Error('Missing ledger-spill profile');

const staged = (name: string, fanoutDirtyRecordsThreshold: number) =>
  ({
    name,
    config: {
      mode: 'hybrid',
      hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
      outboxConfig: {
        stageMaxSteps: 1,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 0,
        stageSmallRunComplexityThreshold: 0,
        fanoutDirtyRecordsThreshold,
        // Lowered so a small fixture crosses the same threshold production
        // crossed at 9,783 dirty records.
        ...(fanoutDirtyRecordsThreshold > 0 ? { fanoutSeedSplitMaxSeeds: 5 } : {}),
        maxSeedRecordsPerTask: 5000,
      },
    },
  }) as typeof baseProfile;

const ROWS = 12;

/** Stored values come back JSON-decorated and numerically formatted (`121.00#`). */
const normalizeShow = (value: unknown): string => {
  const text = String(value)
    .replaceAll(/[[\]"']/g, '')
    .trim();
  const num = Number.parseFloat(text);
  return Number.isFinite(num) ? `${num}#` : text;
};

type ScenarioResult = {
  executions: number;
  /** Children cut down to the bare chunk size — the pathological fanout shape. */
  tinyChildren: number;
  /** Children with seeds at all, i.e. ordinary continuations plus fanout children. */
  children: number;
  rounds: number;
  storedValues: Record<string, string>;
  expectedValues: Record<string, string>;
};

const runScenario = async (profile: typeof baseProfile): Promise<ScenarioResult> => {
  const harness = await createConvergenceHarness(profile);
  const db = harness.testContainer.db;
  try {
    const { fieldId } = harness;
    const hubFields = { name: fieldId(), num: fieldId() };
    const hub = await harness.createTable('Supplier Products', [
      { id: hubFields.name, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: hubFields.num, name: 'Num', type: 'number' },
    ]);

    const listingFields = {
      name: fieldId(),
      linkToHub: fieldId(),
      lookHubNum: fieldId(),
      showHubNum: fieldId(),
    };
    const listings = await harness.createTable('Store Listings', [
      { id: listingFields.name, name: 'Name', type: 'singleLineText', isPrimary: true },
    ]);
    await harness.createField(listings, {
      id: listingFields.linkToHub,
      name: 'Product',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: hub.id,
        lookupFieldId: hubFields.name,
        isOneWay: false,
      },
    });
    await harness.createField(listings, {
      id: listingFields.lookHubNum,
      name: 'Product num',
      type: 'lookup',
      options: {
        linkFieldId: listingFields.linkToHub,
        foreignTableId: hub.id,
        lookupFieldId: hubFields.num,
      },
    });
    await harness.createField(listings, {
      id: listingFields.showHubNum,
      name: 'Show',
      type: 'formula',
      options: { expression: `CONCATENATE({${listingFields.lookHubNum}}, "#")` },
    });

    // Third edge carries the cycle back onto the listings, matching production's
    // Store Listings <-> Supplier Products <-> Inventory Observations triangle.
    const observationFields = { name: fieldId(), linkToHub: fieldId(), linkToListing: fieldId() };
    const observations = await harness.createTable('Inventory Observations', [
      { id: observationFields.name, name: 'Name', type: 'singleLineText', isPrimary: true },
    ]);
    await harness.createField(observations, {
      id: observationFields.linkToHub,
      name: 'Product',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: hub.id,
        lookupFieldId: hubFields.name,
        isOneWay: false,
      },
    });
    await harness.createField(observations, {
      id: observationFields.linkToListing,
      name: 'Store Listings',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: listings.id,
        lookupFieldId: listingFields.name,
        isOneWay: false,
      },
    });

    const hubRows: string[] = [];
    for (let index = 0; index < ROWS; index += 1) {
      hubRows.push(
        await harness.createRecord(hub, { [hubFields.name]: `P${index}`, [hubFields.num]: index })
      );
    }
    const listingRows: string[] = [];
    for (let index = 0; index < ROWS; index += 1) {
      listingRows.push(
        await harness.createRecord(listings, {
          [listingFields.name]: `L${index}`,
          [listingFields.linkToHub]: [{ id: hubRows[index] }],
        })
      );
    }
    for (let index = 0; index < ROWS; index += 1) {
      await harness.createRecord(observations, {
        [observationFields.name]: `O${index}`,
        [observationFields.linkToHub]: [{ id: hubRows[index] }],
        [observationFields.linkToListing]: [{ id: listingRows[index] }],
      });
    }

    // Accumulate the mutation set before draining so the work merges into few
    // tasks with a wide dirty fan-out — the shape that engages the fanout path.
    for (let index = 0; index < ROWS; index += 1) {
      await harness.updateRecord(hub, hubRows[index], { [hubFields.num]: 100 + index });
    }
    for (let index = 0; index < ROWS; index += 1) {
      await harness.updateRecord(listings, listingRows[index], {
        [listingFields.linkToHub]: [{ id: hubRows[(index + 1) % ROWS] }],
      });
    }

    let rounds = 0;
    for (; rounds < 200; rounds += 1) {
      await harness.testContainer.processOutboxOnce();
      const pending = await sql<{ count: number }>`SELECT count(*)::int AS count
        FROM computed_update_outbox WHERE base_id = ${harness.baseId}`.execute(db);
      if (Number(pending.rows[0].count) === 0) break;
    }
    expect(rounds, 'cascade must settle').toBeLessThan(200);

    const runHistory = await sql<{
      executions: number;
      tiny_children: number;
      children: number;
    }>`SELECT count(*)::int AS executions,
             count(*) FILTER (
               WHERE predecessor_task_id IS NOT NULL AND seed_record_count > 0
                 AND seed_record_count <= 5)::int AS tiny_children,
             count(*) FILTER (
               WHERE predecessor_task_id IS NOT NULL AND seed_record_count > 0)::int AS children
      FROM computed_update_run_history WHERE base_id = ${harness.baseId}`.execute(db);

    const showColumn = await sql<{ db_field_name: string }>`SELECT db_field_name FROM field
      WHERE id = ${listingFields.showHubNum}`.execute(db);
    const listingTable = await sql<{ db_table_name: string }>`SELECT db_table_name FROM table_meta
      WHERE id = ${listings.id}`.execute(db);
    const stored = await sql<{ __id: string; show: unknown }>`SELECT __id, ${sql.ref(
      showColumn.rows[0].db_field_name
    )} AS show FROM ${sql.table(listingTable.rows[0].db_table_name)}`.execute(db);

    return {
      executions: Number(runHistory.rows[0].executions),
      tinyChildren: Number(runHistory.rows[0].tiny_children),
      children: Number(runHistory.rows[0].children),
      rounds,
      storedValues: Object.fromEntries(
        stored.rows.map((row) => [String(row.__id), normalizeShow(row.show)])
      ),
      expectedValues: Object.fromEntries(
        listingRows.map((id, index) => [id, `${100 + ((index + 1) % ROWS)}#`])
      ),
    };
  } finally {
    await harness.close();
  }
};

describe('computed fanout split amplification', () => {
  it('bounds the fanout split on a cyclic link cascade and still converges', async () => {
    const control = await runScenario(staged('t7401-fanout-off', 0));
    const enabled = await runScenario(staged('t7401-fanout-on', 10));

    // Work is not skipped in either run: every listing carries the hub value of the
    // row it was relinked to, which the control run proves is reachable.
    expect(control.storedValues).toEqual(control.expectedValues);
    expect(enabled.storedValues).toEqual(enabled.expectedValues);

    // Control: the cascade itself, with no fanout children.
    expect(control.executions, 'control task executions').toBeLessThanOrEqual(40);
    expect(control.tinyChildren, 'control bare-cap children').toBeLessThanOrEqual(5);

    // The fanout path must actually add children on top of ordinary stage
    // splitting, otherwise the bounds below would be satisfied by never splitting.
    expect(enabled.children, 'fanout children beyond the control').toBeGreaterThan(
      control.children
    );

    // Enabled: measured 170 executions / 134 bare-cap children before the change,
    // 109 / 20 after.
    expect(enabled.executions, 'task executions').toBeLessThanOrEqual(140);
    expect(enabled.tinyChildren, 'bare-cap children').toBeLessThanOrEqual(60);
  }, 300_000);
});
