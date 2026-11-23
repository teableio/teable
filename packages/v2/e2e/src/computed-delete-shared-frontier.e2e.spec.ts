/* eslint-disable @typescript-eslint/naming-convention */
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateOutboxTaskInput,
  type ComputedUpdateWorker,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import { sql } from 'kysely';
import { expect, it } from 'vitest';

import { createConvergenceHarness } from './shared/computedConvergence';

it.each([
  { name: 'wide-seed-control', seedPageSize: 100 },
  { name: 'paged-delete', seedPageSize: 2 },
])(
  'T8596 preserves indirect filtered membership with $name',
  async ({ name: profileName, seedPageSize }) => {
    const dirtyPageSize = 3;
    const h = await createConvergenceHarness({
      name: profileName,
      config: {
        mode: 'hybrid',
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        outboxConfig: {
          maxSeedRecordsPerTask: seedPageSize,
          stageMaxDirtyRecords: dirtyPageSize,
          stageMaxSteps: 1,
          stageSmallRunComplexityThreshold: 0,
          runHistoryEnabled: true,
        },
      },
    });
    try {
      const name = h.fieldId();
      const amount = h.fieldId();
      const lines = await h.createTable('Lines', [
        { id: name, name: 'Name', type: 'singleLineText', isPrimary: true },
        { id: amount, name: 'Amount', type: 'number' },
      ]);
      const label = h.fieldId();
      const link = h.fieldId();
      const total = h.fieldId();
      const doubled = h.fieldId();
      const groups = await h.createTable('Groups', [
        { id: label, name: 'Label', type: 'singleLineText', isPrimary: true },
      ]);
      await h.createField(groups, {
        id: link,
        name: 'Lines',
        type: 'link',
        options: { relationship: 'manyMany', foreignTableId: lines.id, lookupFieldId: name },
      });
      await h.createField(groups, {
        id: total,
        name: 'Total',
        type: 'rollup',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId: link,
          foreignTableId: lines.id,
          lookupFieldId: amount,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: name, operator: 'is', value: 'active' }],
          },
        },
      });
      await h.createField(groups, {
        id: doubled,
        name: 'Doubled',
        type: 'formula',
        options: { expression: `{${total}} * 2` },
      });

      const boardName = h.fieldId();
      const boardGroups = h.fieldId();
      const high = h.fieldId();
      const low = h.fieldId();
      const boards = await h.createTable('Boards', [
        { id: boardName, name: 'Name', type: 'singleLineText', isPrimary: true },
      ]);
      // A two-way oneMany stores the FK on Groups. Deleting a Line does not
      // delete these source records, so this indirect traversal stays precise.
      await h.createField(boards, {
        id: boardGroups,
        name: 'Groups',
        type: 'link',
        options: { relationship: 'oneMany', foreignTableId: groups.id, lookupFieldId: label },
      });
      for (const [id, fieldName, operator] of [
        [high, 'Above threshold', 'isGreater'],
        [low, 'Below threshold', 'isLess'],
      ]) {
        await h.createField(boards, {
          id,
          name: fieldName,
          type: 'rollup',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: boardGroups,
            foreignTableId: groups.id,
            lookupFieldId: total,
            filter: { conjunction: 'and', filterSet: [{ fieldId: total, operator, value: 5 }] },
          },
        });
      }

      // The oracle uses mutation inputs only, independently of computed readers.
      const source = new Map<string, { active: boolean; amount: number }>();
      const createLine = async (active: boolean, value: number) => {
        const id = await h.createRecord(lines, {
          [name]: active ? 'active' : 'excluded',
          [amount]: value,
        });
        source.set(id, { active, amount: value });
        return id;
      };
      const keep = await createLine(true, 3);
      const remove = await createLine(true, 5);
      const ignored = await createLine(false, 100);
      const groupLinks = new Map<string, string[]>();
      for (let i = 0; i < 7; i++) {
        const members = i === 0 ? [keep, ignored] : [keep, remove, ignored];
        const id = await h.createRecord(groups, {
          [label]: `Group ${i}`,
          [link]: members.map((id) => ({ id })),
        });
        groupLinks.set(id, members);
      }
      const ids = [...groupLinks.keys()];
      const boardLinks = new Map<string, string[]>();
      for (const [title, members] of [
        ['Affected', ids.slice(1)],
        ['Unaffected control', ids.slice(0, 1)],
      ] as const) {
        const id = await h.createRecord(boards, {
          [boardName]: title,
          [boardGroups]: members.map((id) => ({ id })),
        });
        boardLinks.set(id, [...members]);
      }
      const assertOracle = async (checkpoint: string) => {
        const totals = new Map<string, number>(
          [...groupLinks].map(([id, members]) => [
            id,
            members.reduce((sum, member) => {
              const row = source.get(member);
              return sum + (row?.active ? row.amount : 0);
            }, 0),
          ])
        );
        const sumMatching = (members: string[], matches: (value: number) => boolean) =>
          members.reduce((sum, member) => {
            const value = totals.get(member)!;
            return sum + (matches(value) ? value : 0);
          }, 0);
        await h.assertStored(
          groups,
          [...totals].map(([id, value]) => ({
            id,
            cells: { [total]: value, [doubled]: value * 2 },
          })),
          checkpoint
        );
        await h.assertStored(
          boards,
          [...boardLinks].map(([id, members]) => ({
            id,
            cells: {
              [high]: sumMatching(members, (value) => value > 5),
              [low]: sumMatching(members, (value) => value < 5),
            },
          })),
          checkpoint
        );
      };
      await h.drain();
      await assertOracle('initial old membership');

      // Exercise a real link edit before deletion: one old high member joins low.
      await h.updateRecord(groups, ids[1], { [link]: [{ id: keep }, { id: ignored }] });
      groupLinks.set(ids[1], [keep, ignored]);
      await h.drain();
      await assertOracle('link edit changes filtered membership');

      // A newly created linked group must join the same downstream frontier.
      const created = await h.createRecord(groups, {
        [label]: 'Created group',
        [link]: [{ id: keep }, { id: remove }],
      });
      groupLinks.set(created, [keep, remove]);
      const affectedBoard = [...boardLinks.keys()][0];
      const affectedMembers = [...boardLinks.get(affectedBoard)!, created];
      await h.updateRecord(boards, affectedBoard, {
        [boardGroups]: affectedMembers.map((id) => ({ id })),
      });
      boardLinks.set(affectedBoard, affectedMembers);
      await h.drain();
      await assertOracle('creation joins filtered membership');

      const before = await sql<{ task_id: string }>`SELECT task_id FROM computed_update_run_history
      WHERE base_id = ${h.baseId}`.execute(h.testContainer.db);
      expect(before.rows.length, 'history must observe real worker completions').toBeGreaterThan(0);
      await h.deleteRecord(lines, remove);
      source.delete(remove);
      await h.drain();
      await assertOracle('deletion removes old matches and adds new matches');

      const history = await sql<{ executions: number; traversals: number; full_refreshes: number }>`
      SELECT count(DISTINCT history.task_id)::int AS executions,
        count(*) FILTER (WHERE edge->>'fromTableId' = ${groups.id}
          AND edge->>'toTableId' = ${boards.id}
          AND edge->>'propagationMode' = 'linkTraversal')::int AS traversals,
        count(*) FILTER (WHERE edge->>'fromTableId' = ${groups.id}
          AND edge->>'toTableId' = ${boards.id}
          AND edge->>'propagationMode' = 'allTargetRecords')::int AS full_refreshes
      FROM computed_update_run_history AS history
      LEFT JOIN LATERAL jsonb_array_elements(history.edges::jsonb) AS edge ON true
      WHERE history.base_id = ${h.baseId}
        AND history.task_id NOT IN (${sql.join(before.rows.map((row) => row.task_id))})
    `.execute(h.testContainer.db);
      expect(
        history.rows[0].traversals,
        'indirect live-source traversal must execute'
      ).toBeGreaterThan(0);
      // Original planner broadened every filtered downstream edge on DELETE,
      // cloning a full Boards refresh into each seed page despite live Groups.
      expect(
        history.rows[0].full_refreshes,
        'no downstream table refresh cloned per seed page'
      ).toBe(0);
      // Each partial transaction shares its dirty budget between input and propagation.
      const sourcesPerPage = Math.min(seedPageSize, Math.max(1, Math.floor(dirtyPageSize / 2)));
      const affectedGroups = [...groupLinks.values()].filter((members) => members.includes(remove));
      const pages = Math.ceil(affectedGroups.length / sourcesPerPage);
      expect(
        history.rows[0].executions,
        'bounded continuation work for the three-level fixture'
      ).toBeLessThanOrEqual(8 * pages + 8);
    } finally {
      await h.close();
    }
  },
  240_000
);

it('T8660 keeps filtered reverse oneMany lookup and rollup scoped across split delete jobs', async () => {
  const h = await createConvergenceHarness({
    name: 'filtered-reverse-one-many-split-delete',
    config: {
      mode: 'hybrid',
      hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
      outboxConfig: {
        maxSeedRecordsPerTask: 1,
        seedInlineLimit: 0,
        stageMaxSteps: 1,
        stageMaxDirtyRecords: 2,
        stageSmallRunComplexityThreshold: 0,
        runHistoryEnabled: true,
      },
    },
  });
  try {
    const parentName = h.fieldId();
    const childName = h.fieldId();
    const status = h.fieldId();
    const childParent = h.fieldId();
    const parentChildren = h.fieldId();
    const lookup = h.fieldId();
    const count = h.fieldId();
    const parents = await h.createTable('Parents', [
      { id: parentName, name: 'Name', type: 'singleLineText', isPrimary: true },
    ]);
    const children = await h.createTable('Children', [
      { id: childName, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: status, name: 'Status', type: 'singleLineText' },
    ]);
    // The symmetric parent side is oneMany, with the FK on the deleted child.
    await h.createField(children, {
      id: childParent,
      name: 'Parent',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: parents.id,
        lookupFieldId: parentName,
        symmetricFieldId: parentChildren,
        isOneWay: false,
      },
    });
    const filtered = {
      foreignTableId: children.id,
      linkFieldId: parentChildren,
      lookupFieldId: childName,
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: status, operator: 'is', value: 'included' }],
      },
    };
    await h.createField(parents, {
      id: lookup,
      name: 'Included names',
      type: 'lookup',
      options: filtered,
    });
    await h.createField(parents, {
      id: count,
      name: 'Included count',
      type: 'rollup',
      options: { expression: 'countall({values})' },
      config: filtered,
    });
    const emptyParent = await h.createRecord(parents, { [parentName]: 'Empty after delete' });
    const retainedParent = await h.createRecord(parents, { [parentName]: 'Retains a match' });
    const controlParent = await h.createRecord(parents, { [parentName]: 'Unrelated control' });
    const child = (name: string, owner: string, included = true) =>
      h.createRecord(children, {
        [childName]: name,
        [status]: included ? 'included' : 'excluded',
        [childParent]: { id: owner },
      });
    const removeEmpty = await child('Remove empty', emptyParent);
    const removeRetained = await child('Keep', retainedParent);
    await child('Keep', retainedParent);
    await child('Excluded', retainedParent, false);
    await child('Control', controlParent);
    await h.drain();
    await h.assertStored(
      parents,
      [
        { id: emptyParent, cells: { [lookup]: ['Remove empty'], [count]: 1 } },
        { id: retainedParent, cells: { [lookup]: ['Keep', 'Keep'], [count]: 2 } },
        { id: controlParent, cells: { [lookup]: ['Control'], [count]: 1 } },
      ],
      'before batch delete'
    );

    const before = await sql<{ task_id: string }>`SELECT task_id FROM computed_update_run_history
      WHERE base_id = ${h.baseId}`.execute(h.testContainer.db);
    expect(before.rows.length).toBeGreaterThan(0);
    // One API request deletes rows belonging to two parents; the seed limit
    // forces a boundary between the source records and their parent scopes.
    await h.deleteRecords(children, [removeEmpty, removeRetained]);
    await h.drain();
    await h.assertStored(
      parents,
      [
        { id: emptyParent, cells: { [lookup]: null, [count]: 0 } },
        { id: retainedParent, cells: { [lookup]: ['Keep'], [count]: 1 } },
        { id: controlParent, cells: { [lookup]: ['Control'], [count]: 1 } },
      ],
      'after split batch delete'
    );

    const history = await sql<{ executions: number; broad_edges: number }>`
      SELECT count(DISTINCT history.task_id)::int AS executions,
        count(*) FILTER (WHERE edge->>'fromTableId' = ${children.id}
          AND edge->>'toTableId' = ${parents.id}
          AND edge->>'propagationMode' = 'allTargetRecords')::int AS broad_edges
      FROM computed_update_run_history AS history
      LEFT JOIN LATERAL jsonb_array_elements(history.edges::jsonb) AS edge ON true
      WHERE history.base_id = ${h.baseId}
        AND history.task_id NOT IN (${sql.join(before.rows.map((row) => row.task_id))})
    `.execute(h.testContainer.db);
    expect(history.rows[0].executions, 'split work reaches the real worker').toBeGreaterThan(1);
    expect(history.rows[0].broad_edges, 'covered parent scopes avoid a full-table edge').toBe(0);
  } finally {
    await h.close();
  }
}, 240_000);

it('T8664 persists a wide delete continuation directly in its stage ledger', async () => {
  const h = await createConvergenceHarness({
    name: 'delete-continuation-ledger-handoff',
    config: {
      mode: 'hybrid',
      hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
      outboxConfig: {
        maxSeedRecordsPerTask: 1,
        seedInlineLimit: 0,
        stageMaxSteps: 1,
        stageMaxDirtyRecords: 100,
        stageSmallRunComplexityThreshold: 0,
        continuationRelayClaimEnabled: false,
      },
    },
  });
  try {
    const lineName = h.fieldId();
    const amount = h.fieldId();
    const status = h.fieldId();
    const lines = await h.createTable('Lines', [
      { id: lineName, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: amount, name: 'Amount', type: 'number' },
      { id: status, name: 'Status', type: 'singleLineText' },
    ]);
    const groupName = h.fieldId();
    const groupLines = h.fieldId();
    const total = h.fieldId();
    const groups = await h.createTable('Groups', [
      { id: groupName, name: 'Name', type: 'singleLineText', isPrimary: true },
    ]);
    await h.createField(groups, {
      id: groupLines,
      name: 'Lines',
      type: 'link',
      options: { relationship: 'manyMany', foreignTableId: lines.id, lookupFieldId: lineName },
    });
    await h.createField(groups, {
      id: total,
      name: 'Total',
      type: 'rollup',
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: groupLines,
        foreignTableId: lines.id,
        lookupFieldId: amount,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: status, operator: 'is', value: 'included' }],
        },
      },
    });
    const boardName = h.fieldId();
    const boardGroups = h.fieldId();
    const boardTotal = h.fieldId();
    const doubled = h.fieldId();
    const final = h.fieldId();
    const boards = await h.createTable('Boards', [
      { id: boardName, name: 'Name', type: 'singleLineText', isPrimary: true },
    ]);
    await h.createField(boards, {
      id: boardGroups,
      name: 'Groups',
      type: 'link',
      options: { relationship: 'manyMany', foreignTableId: groups.id, lookupFieldId: groupName },
    });
    await h.createField(boards, {
      id: boardTotal,
      name: 'Group total',
      type: 'rollup',
      options: { expression: 'sum({values})' },
      config: { linkFieldId: boardGroups, foreignTableId: groups.id, lookupFieldId: total },
    });
    await h.createField(boards, {
      id: doubled,
      name: 'Doubled',
      type: 'formula',
      options: { expression: `{${boardTotal}} * 2` },
    });
    await h.createField(boards, {
      id: final,
      name: 'Final',
      type: 'formula',
      options: { expression: `{${doubled}} + 1` },
    });

    const line = (name: string, value: number, included = true) =>
      h.createRecord(lines, {
        [lineName]: name,
        [amount]: value,
        [status]: included ? 'included' : 'excluded',
      });
    const removed = await line('Removed', 5);
    const retained = await line('Retained', 3);
    const ignored = await line('Ignored', 50, false);
    const controlLine = await line('Control', 7);
    const affected = await h.createRecord(groups, {
      [groupName]: 'Affected',
      [groupLines]: [removed, retained, ignored].map((id) => ({ id })),
    });
    const control = await h.createRecord(groups, {
      [groupName]: 'Control',
      [groupLines]: [{ id: controlLine }],
    });
    const affectedBoards: string[] = [];
    for (let index = 0; index < 5; index++) {
      affectedBoards.push(
        await h.createRecord(boards, {
          [boardName]: `Affected ${index}`,
          [boardGroups]: [{ id: affected }],
        })
      );
    }
    const controlBoard = await h.createRecord(boards, {
      [boardName]: 'Control',
      [boardGroups]: [{ id: control }],
    });
    const assertBoards = (value: number, checkpoint: string) =>
      h.assertStored(
        boards,
        [
          ...affectedBoards.map((id) => ({
            id,
            cells: { [boardTotal]: value, [doubled]: value * 2, [final]: value * 2 + 1 },
          })),
          { id: controlBoard, cells: { [boardTotal]: 7, [doubled]: 14, [final]: 15 } },
        ],
        checkpoint
      );
    await h.drain();
    await assertBoards(8, 'before delete');

    const outbox = h.testContainer.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    const worker = h.testContainer.container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );
    const enqueue = outbox.enqueueOrMerge;
    const seedKeys = (input: ComputedUpdateOutboxTaskInput) => {
      const seedAll = new Set(input.seedAllTableIds ?? []);
      if (input.beforeImageRecords.length) seedAll.delete(input.seedTableId);
      return new Set([
        ...(!seedAll.has(input.seedTableId)
          ? input.seedRecordIds.map((recordId) => `${input.seedTableId}:${recordId}`)
          : []),
        ...input.extraSeedRecords.flatMap((group) =>
          seedAll.has(group.tableId)
            ? []
            : group.recordIds.map((recordId) => `${group.tableId}:${recordId}`)
        ),
      ]);
    };
    const candidates: { id: string; expected: Set<string> }[] = [];
    outbox.enqueueOrMerge = async function (input, context, options) {
      const result = await enqueue.call(this, input, context, options);
      const expected = seedKeys(input);
      if (
        result.isOk() &&
        !result.value.merged &&
        input.predecessorTaskId &&
        input.changeType === 'delete' &&
        !input.ledgerScopeId &&
        !input.partialStageBudget &&
        !input.seedAllCursors &&
        expected.size > 1 &&
        expected.size <= 25_000
      ) {
        candidates.push({ id: result.value.taskId, expected });
      }
      return result;
    };
    let checked = 0;
    try {
      await h.deleteRecord(lines, removed);
      for (let round = 0; round < 300; round++) {
        const next = await sql<{ id: string }>`SELECT id FROM computed_update_outbox
          WHERE base_id = ${h.baseId} AND status = 'pending' ORDER BY created_at, id LIMIT 1`.execute(
          h.testContainer.db
        );
        if (!next.rows.length) break;
        const result = await worker.runTaskById({
          taskId: next.rows[0].id,
          workerId: 'delete-ledger-proof',
          yieldAfterTask: true,
        });
        expect(result.isOk(), result.isErr() ? result.error.message : undefined).toBe(true);
        while (checked < candidates.length) {
          const { id, expected } = candidates[checked++];
          const task = await sql<{
            seed_record_ids: unknown;
            dirty_stats: {
              ledgerScopeId?: string;
            };
          }>`SELECT seed_record_ids, dirty_stats FROM computed_update_outbox WHERE id = ${id}`.execute(
            h.testContainer.db
          );
          expect(task.rows).toHaveLength(1);
          expect(task.rows[0].seed_record_ids).toEqual([]);
          expect(task.rows[0].dirty_stats.ledgerScopeId).toBe(id);
          const spilled = await sql<{ count: number }>`SELECT count(*)::int AS count
            FROM computed_update_outbox_seed WHERE task_id = ${id}`.execute(h.testContainer.db);
          expect(spilled.rows[0].count).toBe(0);
          const ledger = await sql<{ kind: string; table_id: string; record_id: string }>`
            SELECT kind, table_id, record_id FROM computed_update_stage_ledger WHERE scope_id = ${id}
          `.execute(h.testContainer.db);
          for (const kind of ['frontier', 'rerun-source']) {
            expect(
              new Set(
                ledger.rows
                  .filter((row) => row.kind === kind)
                  .map((row) => `${row.table_id}:${row.record_id}`)
              )
            ).toEqual(expected);
          }
          expect(ledger.rows.filter((row) => row.kind === 'rerun-input-v1')).toHaveLength(1);
        }
        const pending = await sql<{ count: number }>`SELECT count(*)::int AS count
          FROM computed_update_outbox WHERE base_id = ${h.baseId}`.execute(h.testContainer.db);
        if (!pending.rows[0].count) break;
        if (round === 299) throw new Error('Delete continuation did not settle');
      }
    } finally {
      outbox.enqueueOrMerge = enqueue;
    }
    expect(
      checked,
      'a wide planned delete continuation crossed the durable handoff'
    ).toBeGreaterThan(0);
    const remaining = await sql<{ count: number }>`SELECT count(*)::int AS count
      FROM computed_update_outbox WHERE base_id = ${h.baseId}`.execute(h.testContainer.db);
    expect(remaining.rows[0].count).toBe(0);
    const dead = await sql<{ count: number }>`SELECT count(*)::int AS count
      FROM computed_update_dead_letter WHERE base_id = ${h.baseId}`.execute(h.testContainer.db);
    expect(dead.rows[0].count).toBe(0);
    await assertBoards(3, 'after delete');

    // Deleting a filtered-out source is a real no-effect mutation, and must not
    // change either the affected branch or the independently linked control.
    await h.deleteRecord(lines, ignored);
    await h.drain();
    await assertBoards(3, 'after no-effect delete');
  } finally {
    await h.close();
  }
}, 240_000);
