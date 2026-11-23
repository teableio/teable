/* eslint-disable @typescript-eslint/naming-convention */
import { writeFileSync } from 'node:fs';
import {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
} from '@teable/v2-adapter-table-repository-postgres';
import { ActorId, DeleteRecordsCommand, v2CoreTokens } from '@teable/v2-core';
import type {
  DeleteRecordsResult,
  ICommandBus,
  ISpan,
  ITracer,
  SpanAttributeValue,
  SpanAttributes,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { expect, it, vi } from 'vitest';

import {
  createConvergenceHarness,
  type ConvergenceTable,
  type ExpectedRow,
} from './shared/computedConvergence';

// This fixture is copied byte-for-byte onto both immutable revisions by the remote runner.
// Ordinary convergence suites keep their existing fixtures and assertions.
it.skipIf(process.env.COMPUTED_DOUBLE_DELETE_PROOF !== '1')(
  'T8596 paired two-source batch deletion matches an independent persisted-cell oracle',
  async () => {
    expect(process.env.GITHUB_ACTIONS, 'remote Actions proof only').toBe('true');
    expect(process.env.COMPUTED_DATABASE_URL, 'real isolated PostgreSQL required').toBeTruthy();
    const mode = process.env.COMPUTED_DOUBLE_DELETE_MODE;
    expect(['base', 'candidate', 'forced-full']).toContain(mode);
    const h = await createConvergenceHarness({
      name: `double-delete-${mode}`,
      config: {
        mode: 'hybrid',
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        outboxConfig: {
          maxSeedRecordsPerTask: 2,
          stageMaxDirtyRecords: 3,
          stageMaxSteps: 1,
          stageSmallRunComplexityThreshold: 0,
          runHistoryEnabled: true,
        },
      },
    });
    const snapshots: Record<string, unknown> = {};
    const spanRecords: {
      name: string;
      attributes: Record<string, SpanAttributeValue>;
      ended: boolean;
      errors: string[];
    }[] = [];
    const tracer: ITracer = {
      startSpan(name, attributes = {}) {
        const record = {
          name: String(name),
          attributes: { ...attributes },
          ended: false,
          errors: [] as string[],
        };
        spanRecords.push(record);
        return {
          setAttribute(key, value) {
            record.attributes[key] = value;
          },
          setAttributes(values: SpanAttributes) {
            Object.assign(record.attributes, values);
          },
          recordError(message) {
            record.errors.push(message);
          },
          end() {
            record.ended = true;
          },
        };
      },
      withSpan<T>(_span: ISpan, callback: () => Promise<T>) {
        return callback();
      },
      getActiveSpan() {
        return undefined;
      },
    };
    let forcedEdges = 0;
    const originalPlan = ComputedUpdatePlanner.prototype.planStage;
    const plannerSpy = vi
      .spyOn(ComputedUpdatePlanner.prototype, 'planStage')
      .mockImplementation(async function (this: ComputedUpdatePlanner, ...args) {
        const result = await originalPlan.apply(this, args);
        if (mode !== 'forced-full') return result;
        return result.map((plan) => ({
          ...plan,
          edges: plan.edges.map((edge) => {
            forcedEdges++;
            return {
              ...edge,
              propagationMode: 'allTargetRecords' as const,
              allTargetRecordsReasons: undefined,
            };
          }),
        }));
      });
    // Inject observation only. Both revisions already emit these spans; product code is unchanged.
    const originalExecute = ComputedFieldUpdater.prototype.execute;
    const executorSpy = vi
      .spyOn(ComputedFieldUpdater.prototype, 'execute')
      .mockImplementation(function (this: ComputedFieldUpdater, plan, context, run, options) {
        return originalExecute.call(this, plan, { ...context, tracer }, run, options);
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
      const source = new Map<string, { title: string; active: boolean; amount: number }>();
      const line = async (title: string, value: number, active = true) => {
        const id = await h.createRecord(lines, {
          [name]: active ? 'active' : 'excluded',
          [amount]: value,
        });
        source.set(id, { title, active, amount: value });
        return id;
      };
      const keep = await line('keep', 3);
      const first = await line('delete-first', 5);
      const second = await line('delete-second', 2);
      const ignored = await line('filtered', 100, false);
      const groupLinks = new Map<string, { title: string; members: string[] }>();
      for (let i = 0; i < 7; i++) {
        const members =
          i === 0
            ? [keep, ignored]
            : i === 1
              ? [keep, first, ignored]
              : i === 2
                ? [keep, second, ignored]
                : [keep, first, second, ignored];
        const title = `Group ${i}`;
        const id = await h.createRecord(groups, {
          [label]: title,
          [link]: members.map((id) => ({ id })),
        });
        groupLinks.set(id, { title, members });
      }
      const groupIds = [...groupLinks.keys()];
      const boardLinks = new Map<string, { title: string; members: string[] }>();
      for (const [title, members] of [
        ['Affected', groupIds.slice(1)],
        ['Unaffected', groupIds.slice(0, 1)],
      ] as const) {
        const id = await h.createRecord(boards, {
          [boardName]: title,
          [boardGroups]: members.map((id) => ({ id })),
        });
        boardLinks.set(id, { title, members });
      }
      // Read physical columns, assert ALL persisted rows/cells, then normalize random IDs
      // to input labels for exact cross-revision comparison. Expected cells use inputs only.
      const check = async (
        table: ConvergenceTable,
        expected: ExpectedRow[],
        titles: Map<string, string>,
        fields: [string, string][]
      ) => {
        await h.assertStored(table, expected, 'double-delete independent oracle');
        const meta = await sql<{
          db_table_name: string;
        }>`SELECT db_table_name FROM table_meta WHERE id = ${table.id}`.execute(h.testContainer.db);
        const columns = await sql<{
          id: string;
          db_field_name: string;
        }>`SELECT id, db_field_name FROM field WHERE table_id = ${table.id} AND deleted_time IS NULL`.execute(
          h.testContainer.db
        );
        const byId = new Map(columns.rows.map((row) => [row.id, row.db_field_name]));
        const rows = await sql<
          Record<string, unknown>
        >`SELECT __id, ${sql.join(fields.map(([id, alias]) => sql`${sql.ref(byId.get(id)!)} AS ${sql.id(alias)}`))} FROM ${sql.table(meta.rows[0].db_table_name)} ORDER BY __id`.execute(
          h.testContainer.db
        );
        return Object.fromEntries(
          rows.rows.map(({ __id, ...cells }) => [titles.get(String(__id))!, cells])
        );
      };
      const oracle = async (checkpoint: string) => {
        const totals = new Map(
          [...groupLinks].map(([id, { members }]) => [
            id,
            members.reduce((sum, member) => {
              const row = source.get(member);
              return sum + (row?.active ? row.amount : 0);
            }, 0),
          ])
        );
        const matching = (members: string[], predicate: (value: number) => boolean) =>
          members.reduce((sum, id) => {
            const value = totals.get(id)!;
            return sum + (predicate(value) ? value : 0);
          }, 0);
        snapshots[checkpoint] = {
          lines: await check(
            lines,
            [...source].map(([id, row]) => ({
              id,
              cells: { [name]: row.active ? 'active' : 'excluded', [amount]: row.amount },
            })),
            new Map([...source].map(([id, row]) => [id, row.title])),
            [
              [name, 'name'],
              [amount, 'amount'],
            ]
          ),
          groups: await check(
            groups,
            [...totals].map(([id, value]) => ({
              id,
              cells: { [total]: value, [doubled]: value * 2 },
            })),
            new Map([...groupLinks].map(([id, row]) => [id, row.title])),
            [
              [total, 'total'],
              [doubled, 'doubled'],
            ]
          ),
          boards: await check(
            boards,
            [...boardLinks].map(([id, { members }]) => ({
              id,
              cells: {
                [high]: matching(members, (n) => n > 5),
                [low]: matching(members, (n) => n < 5),
              },
            })),
            new Map([...boardLinks].map(([id, row]) => [id, row.title])),
            [
              [high, 'high'],
              [low, 'low'],
            ]
          ),
        };
      };
      await h.drain();
      await oracle('initial');
      // Change a filter input in both directions, including the unaffected delete control.
      for (const active of [true, false]) {
        await h.updateRecord(lines, ignored, { [name]: active ? 'active' : 'excluded' });
        source.get(ignored)!.active = active;
        await h.drain();
        await oracle(active ? 'filter-enters' : 'filter-leaves');
      }
      await h.updateRecord(groups, groupIds[1], {
        [link]: [keep, second, ignored].map((id) => ({ id })),
      });
      groupLinks.get(groupIds[1])!.members = [keep, second, ignored];
      await h.drain();
      await oracle('link-edit');
      const created = await h.createRecord(groups, {
        [label]: 'Created group',
        [link]: [keep, first, second].map((id) => ({ id })),
      });
      groupLinks.set(created, { title: 'Created group', members: [keep, first, second] });
      const affectedBoard = [...boardLinks.keys()][0];
      boardLinks.get(affectedBoard)!.members.push(created);
      await h.updateRecord(boards, affectedBoard, {
        [boardGroups]: boardLinks.get(affectedBoard)!.members.map((id) => ({ id })),
      });
      await h.drain();
      await oracle('before-delete');
      const historyBefore = await sql<{
        task_id: string;
      }>`SELECT task_id FROM computed_update_run_history WHERE base_id = ${h.baseId}`.execute(
        h.testContainer.db
      );
      spanRecords.length = 0;
      executorSpy.mockClear();
      forcedEdges = 0;
      // Exactly ONE batch command, with exactly TWO source record IDs.
      const command = DeleteRecordsCommand.create({
        tableId: lines.id,
        recordIds: [first, second],
      })._unsafeUnwrap();
      const bus = h.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const result = await bus.execute<DeleteRecordsCommand, DeleteRecordsResult>(
        { actorId: ActorId.create('system')._unsafeUnwrap() },
        command
      );
      result._unsafeUnwrap();
      source.delete(first);
      source.delete(second);
      await h.drain();
      await oracle('after-delete');
      const queue = await sql<{ pending: number; dead: number }>`SELECT
        (SELECT count(*)::int FROM computed_update_outbox WHERE base_id = ${h.baseId}) AS pending,
        (SELECT count(*)::int FROM computed_update_dead_letter WHERE base_id = ${h.baseId}) AS dead`.execute(
        h.testContainer.db
      );
      expect(queue.rows[0]).toEqual({ pending: 0, dead: 0 });
      const history = await sql<{
        task_id: string;
      }>`SELECT task_id FROM computed_update_run_history WHERE base_id = ${h.baseId} AND outcome = 'succeeded'`.execute(
        h.testContainer.db
      );
      const beforeIds = new Set(historyBefore.rows.map((row) => row.task_id));
      const completedTaskIds = [
        ...new Set(history.rows.map((row) => row.task_id).filter((id) => !beforeIds.has(id))),
      ];
      const executions = spanRecords.filter(
        (span) => span.name === 'teable.ComputedFieldUpdater.execute'
      );
      const batches = spanRecords.filter(
        (span) => span.name === 'teable.ComputedFieldUpdater.step'
      );
      expect(executions.length, 'common executor instrumentation must be observed').toBeGreaterThan(
        0
      );
      expect(batches.length, 'common batch instrumentation must be observed').toBeGreaterThan(0);
      expect(completedTaskIds.length, 'history records actual completed tasks').toBeGreaterThan(0);
      expect(spanRecords.every((span) => span.ended && span.errors.length === 0)).toBe(true);
      if (mode === 'forced-full') expect(forcedEdges).toBeGreaterThan(0);
      const output = {
        mode,
        revision: process.env.COMPUTED_DOUBLE_DELETE_REVISION,
        snapshots,
        counters: {
          executorCalls: executorSpy.mock.calls.length,
          executorStarts: executions.length,
          stepBatches: batches.length,
          emptyStepBatches: batches.filter(
            (span) =>
              span.attributes['step.dirtyRecordCount'] === 0 ||
              span.attributes['step.fieldCount'] === 0
          ).length,
          completedTasks: completedTaskIds.length,
          forcedFullEdges: forcedEdges,
        },
        queue: queue.rows[0],
        spans: spanRecords,
      };
      writeFileSync(process.env.COMPUTED_DOUBLE_DELETE_OUTPUT!, JSON.stringify(output, null, 2));
    } finally {
      executorSpy.mockRestore();
      plannerSpy.mockRestore();
      await h.close();
    }
  },
  240_000
);
