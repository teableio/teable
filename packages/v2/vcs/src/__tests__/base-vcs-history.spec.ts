import {
  ActorId,
  Base,
  BaseId,
  BaseName,
  DbTableName,
  FieldId,
  FieldName,
  ListTablesQuery,
  NoopTableSchemaCoordination,
  Table,
  TableId,
  TableName,
  createTableSchemaCoordinationLease,
  domainError,
  withTableSchemaCoordination,
  type IDomainWriteTransaction,
  type IExecutionContext,
  type IQueryBus,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseVcsHistoryService } from '../application/server/BaseVcsHistoryService';
import {
  PushVcsPatchService,
  pushVcsPatchInputSchema,
} from '../application/server/PushVcsPatchService';
import { diffSnapshots, summarizePatch } from '../domain/diffSnapshots';
import type { IBaseVcsSnapshot, IFieldVcsSnapshot } from '../domain/types';
import type { IBaseVcsLogRepository, IVcsCommit, VcsHistoryAccess } from '../ports/server';

const id = (prefix: string, suffix: string) => prefix + suffix.repeat(16);
const baseId = id('bse', 'a');
const tableId = id('tbl', 'a');
const primary = id('fld', 'a');
const masked = id('fld', 'b');
const link = id('fld', 'c');
const hidden = id('fld', 'd');
const deleted = id('fld', 'e');
const derived = id('fld', 'f');
const foreign = id('fld', 'g');
const rowA = id('rec', 'a');
const rowB = id('rec', 'b');
const invisibleRow = id('rec', 'x');
const viewId = id('viw', 'a');
const ctx = { actorId: ActorId.create('usr_history_owner')._unsafeUnwrap() };

function field(fieldId: string, type = 'singleLineText'): IFieldVcsSnapshot {
  return {
    id: fieldId,
    name: fieldId,
    type,
    isPrimary: fieldId === primary,
    isComputed: type === 'formula',
  };
}

function snapshot(revision: number): IBaseVcsSnapshot {
  return {
    formatVersion: 1,
    baseId,
    baseName: 'Inventory',
    revision,
    capturedAt: '2026-01-01T00:00:00Z',
    tables: [
      {
        id: tableId,
        name: 'Items',
        primaryFieldId: primary,
        fields: [
          field(primary),
          field(masked),
          field(hidden),
          field(deleted),
          field(derived, 'formula'),
          { ...field(link, 'link'), options: { foreignTableId: tableId } },
          {
            ...field(foreign, 'link'),
            options: { foreignTableId: id('tbl', 'x'), baseId: id('bse', 'x') },
          },
        ],
        views: [
          {
            id: viewId,
            type: 'grid',
            name: 'Grid',
            query: { filter: { value: 'secret predicate' } },
          },
          { id: id('viw', 'x'), type: 'grid', name: 'secret view' },
        ],
        records: [
          {
            id: rowA,
            version: 12,
            fields: {
              [primary]: `public ${revision}`,
              [masked]: `secret masked ${revision}`,
              [hidden]: 'secret field',
              [deleted]: 'secret deleted',
              [derived]: 'secret formula',
              [foreign]: { id: 'secret foreign row' },
              [link]: [
                { id: rowB, title: 'secret cached title' },
                { id: invisibleRow, title: 'secret record' },
              ],
            },
          },
          { id: rowB, fields: { [primary]: 'second', [masked]: 'readable on B' } },
          { id: invisibleRow, fields: { [primary]: 'secret row' } },
        ],
      },
      {
        id: id('tbl', 'z'),
        name: 'secret deleted table',
        primaryFieldId: primary,
        fields: [field(primary)],
        views: [],
        records: [],
      },
    ],
  };
}

function currentTable() {
  const builder = Table.builder()
    .withBaseId(BaseId.create(baseId)._unsafeUnwrap())
    .withId(TableId.create(tableId)._unsafeUnwrap())
    .withName(TableName.create('Items')._unsafeUnwrap())
    .withDbTableName(DbTableName.rehydrate(`${baseId}.${tableId}`)._unsafeUnwrap());
  for (const fieldId of [primary, masked, link, hidden, derived, foreign]) {
    const item = builder
      .field()
      .singleLineText()
      .withId(FieldId.create(fieldId)._unsafeUnwrap())
      .withName(FieldName.create(fieldId)._unsafeUnwrap());
    if (fieldId === primary) item.primary();
    item.done();
  }
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
}

type BaseVcsHistoryServiceCapture = ConstructorParameters<
  typeof BaseVcsHistoryService
>[3]['capture'];

function harness(
  grant: VcsHistoryAccess,
  table = currentTable(),
  options: { retryBatch?: boolean } = {}
) {
  const raw = diffSnapshots(snapshot(1), snapshot(2));
  const read = vi.fn<IBaseVcsLogRepository['readHistoricalSnapshot']>(async (_ctx, _base, rev) =>
    ok(snapshot(rev))
  );
  const readIds = vi.fn<IBaseVcsLogRepository['readHistoricalTableIds']>(async () =>
    ok([tableId, id('tbl', 'z')])
  );
  const compare = vi.fn<IBaseVcsLogRepository['compareHistoricalRevisions']>(async () =>
    ok({
      patch: raw,
      summary: summarizePatch(raw),
      mergeBase: 1,
    })
  );
  const getHead = vi.fn<IBaseVcsLogRepository['getHead']>(async () =>
    ok({
      enabled: true,
      headRevision: 2,
      minRetainedSeq: 0,
      minRetainedXid: '0',
    })
  );
  const head = vi.fn<IBaseVcsLogRepository['lockPushMetadata']>((context, id) =>
    getHead(context, id)
  );
  const physical = vi.fn<IBaseVcsLogRepository['lockPushPhysicalTargets']>(async () =>
    ok(undefined)
  );
  const findReceipt = vi.fn<IBaseVcsLogRepository['findCommitByOriginPushId']>(async () =>
    ok(null)
  );
  const capture = vi.fn<BaseVcsHistoryServiceCapture>(async () => ok(snapshot(2)));
  const push = vi.fn<PushVcsPatchService['execute']>();
  const prepareOrders = vi.fn<PushVcsPatchService['prepareRollbackOrderColumns']>();
  const coordination = new NoopTableSchemaCoordination();
  const withWriteCoordination: PushVcsPatchService['withWriteCoordination'] = (
    context,
    tableIds,
    _deletedTableIds,
    mode,
    work
  ) => withTableSchemaCoordination(context, coordination, tableIds, mode, work);
  const queries = {
    execute: vi.fn(async (_ctx: IExecutionContext, query: unknown) => {
      if (query instanceof ListTablesQuery) return ok({ tables: [table] });
      return ok({
        records: [
          { id: rowA, fields: { [primary]: '', [link]: [], [foreign]: null, [derived]: 0 } },
          { id: rowB, fields: { [primary]: '', [masked]: 'current' } },
        ],
        total: 2,
        hasMore: false,
      });
    }) as unknown as IQueryBus['execute'],
  };
  const tx: Pick<IDomainWriteTransaction, 'withBatchTransaction'> = {
    withBatchTransaction: async (context, work) => {
      if (options.retryBatch) await work(context);
      return work(context);
    },
  };
  const service = new BaseVcsHistoryService(
    {
      readHistoricalSnapshot: read,
      readHistoricalTableIds: readIds,
      compareHistoricalRevisions: compare,
      getHead,
      lockPushMetadata: head,
      lockPushPhysicalTargets: physical,
      findCommitByOriginPushId: findReceipt,
    },
    {
      resolveHistoryAccess: async () => ok(grant),
      assertCanApplyPatch: async () => ok(undefined),
    },
    queries,
    { capture },
    tx,
    { execute: push, prepareRollbackOrderColumns: prepareOrders, withWriteCoordination },
    { find: async () => ok([]) }
  );
  return {
    service,
    read,
    readIds,
    compare,
    head: getHead,
    lockMetadata: head,
    physical,
    findReceipt,
    capture,
    push,
    prepareOrders,
    raw,
    coordination,
    tx,
    queries,
  };
}

describe('historical permissions', () => {
  it('projects both endpoints using current rows and per-row field keys before computing the patch', async () => {
    const table = currentTable();
    const { service } = harness(
      {
        kind: 'scoped',
        tables: [
          {
            tableId,
            table,
            readableViewIds: new Set([viewId]),
            isRowFiltered: true,
            readableFieldIds: [primary, masked, link, foreign, derived],
          },
        ],
      },
      table
    );
    const { snapshot: projected } = (
      await service.checkout(ctx, { baseId, revision: 1 })
    )._unsafeUnwrap();
    expect(projected.tables.map((t) => t.id)).toEqual([tableId]);
    const [items] = projected.tables;
    expect(items.views).toEqual([{ id: viewId, type: 'grid', name: 'Grid' }]);
    expect(items.fields.map((f) => f.id)).toEqual([primary, masked, derived, link, foreign]);
    expect(items.records).toEqual([
      { id: rowA, fields: { [primary]: 'public 1', [link]: [{ id: rowB }] } },
      { id: rowB, fields: { [primary]: 'second', [masked]: 'readable on B' } },
    ]);
    expect(JSON.stringify(projected)).not.toContain('secret');
    const diff = (await service.diff(ctx, { baseId, from: 1, to: 2 }))._unsafeUnwrap();
    expect(diff.summary.cellChanges).toBe(1);
    expect(diff.patch.tablesUpdated[0].recordsUpdated).toEqual([
      {
        recordId: rowA,
        cellChanges: [{ fieldId: primary, before: 'public 1', after: 'public 2' }],
      },
    ]);
    expect((await service.rollback(ctx, { baseId, revision: 1 }))._unsafeUnwrapErr().code).toBe(
      'vcs.history_forbidden'
    );
  });

  it('uses the Merkle comparison for a base owner when the repository certifies local references', async () => {
    const { service, compare, read, raw } = harness({ kind: 'full' });
    const publicPatch = { ...raw, tablesUpdated: [] };
    compare.mockResolvedValue(
      ok({
        patch: publicPatch,
        summary: summarizePatch(publicPatch),
        mergeBase: 1,
        containsForeignReferences: false,
      })
    );
    const diff = (await service.diff(ctx, { baseId, from: 1, to: 2 }))._unsafeUnwrap();
    expect(diff).toEqual({
      from: 1,
      to: 2,
      mergeBase: 1,
      patch: publicPatch,
      summary: summarizePatch(publicPatch),
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('redacts cross-base link metadata and values when a legacy comparison has no reference flag', async () => {
    const { service, read } = harness({ kind: 'full' });
    const left = snapshot(1);
    const right = snapshot(2);
    const [items, ...others] = right.tables;
    read.mockResolvedValueOnce(ok(left)).mockResolvedValueOnce(
      ok({
        ...right,
        tables: [
          {
            ...items,
            records: items.records.map((r) => ({
              ...r,
              fields: { ...r.fields, [foreign]: { id: 'other external record' } },
            })),
          },
          ...others,
        ],
      })
    );
    const diff = (await service.diff(ctx, { baseId, from: 1, to: 2 }))._unsafeUnwrap();
    const values = diff.patch.tablesUpdated[0].recordsUpdated.flatMap((r) => r.cellChanges);
    expect(values.map((c) => c.fieldId).sort()).toEqual([primary, masked].sort());
    expect(JSON.stringify(diff)).not.toContain('external record');
    expect(read).toHaveBeenCalledTimes(2);
  });
});

it('replays the exact rollback receipt after the head advances and rejects caller-ID collisions', async () => {
  const { service, findReceipt, push, capture, head, coordination } = harness({
    kind: 'full',
    includesForeignBases: true,
  });
  const summary = summarizePatch(diffSnapshots(snapshot(2), snapshot(1)));
  const receipts: IVcsCommit[] = [];
  push.mockImplementation(async (context, raw, options) => {
    const request = pushVcsPatchInputSchema.parse(raw);
    const result = {
      ok: true,
      dryRun: Boolean(request.dryRun),
      baseId,
      baseRevision: 2,
      newRevision: 3,
      commitId: options?.rollbackCommitId,
      originPushId: request.originPushId,
      rebased: false,
      summary,
    };
    if (!request.dryRun && options?.rollbackCommitId) {
      receipts.push({
        commitId: options.rollbackCommitId,
        actorId: context.actorId.toString(),
        baseId,
        revision: 3,
        parentRevision: 2,
        parents: [2],
        seqUpto: 10,
        originPushId: request.originPushId,
        summary,
        createdAt: '2026-02-01T00:00:00Z',
        message: request.message,
      });
    }
    return ok(result);
  });
  findReceipt.mockImplementation(async () => ok(receipts[0] ?? null));
  const preview = (await service.rollback(ctx, { baseId, revision: 1 }))._unsafeUnwrap();
  if (!preview.dryRun) throw new Error('Expected rollback preview');
  const input = {
    baseId,
    revision: 1,
    confirmation: preview.confirmation,
    originPushId: 'same-id',
  };
  const first = (await service.rollback(ctx, input))._unsafeUnwrap();
  expect(first).toMatchObject({ dryRun: false, result: { newRevision: 3 } });
  head.mockResolvedValue(
    ok({ enabled: true, headRevision: 5, minRetainedSeq: 0, minRetainedXid: '0' })
  );
  capture.mockClear();
  expect((await service.rollback(ctx, input))._unsafeUnwrap()).toEqual(first);
  const busy = domainError.conflict({ code: 'schema_coordination.busy', message: 'Busy' });
  const acquire = vi.spyOn(coordination, 'acquire');
  findReceipt.mockResolvedValueOnce(ok(null));
  acquire.mockResolvedValueOnce(err(busy));
  expect((await service.rollback(ctx, input))._unsafeUnwrap()).toEqual(first);
  findReceipt.mockResolvedValueOnce(ok(null)).mockResolvedValueOnce(ok(null));
  acquire.mockResolvedValueOnce(err(busy));
  expect((await service.rollback(ctx, input))._unsafeUnwrapErr().code).toBe(busy.code);
  for (const [actor, request] of [
    [ctx, { ...input, revision: 0 }],
    [ctx, { ...input, confirmation: 'another-token' }],
    [{ actorId: ActorId.create('usr_other_owner')._unsafeUnwrap() }, input],
  ] as const) {
    expect((await service.rollback(actor, request))._unsafeUnwrapErr().code).toBe(
      'vcs.origin_push_id_used'
    );
  }
  const ordinary = { ...receipts[0], commitId: 'vcsc_ordinary', message: 'Rollback to revision 1' };
  findReceipt.mockResolvedValue(ok(ordinary));
  expect((await service.rollback(ctx, input))._unsafeUnwrapErr().code).toBe(
    'vcs.origin_push_id_used'
  );
  expect(capture).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledTimes(2);
});

it('rejects an unchanged head and inverse patch if an observed live record version changed', async () => {
  const { service, capture, push } = harness({ kind: 'full', includesForeignBases: true });
  const state = snapshot(2);
  const [items, ...rest] = state.tables;
  const summary = summarizePatch(diffSnapshots(state, snapshot(1)));
  push.mockResolvedValue(
    ok({ ok: true, dryRun: true, baseId, baseRevision: 2, newRevision: 2, rebased: false, summary })
  );
  const preview = (await service.rollback(ctx, { baseId, revision: 1 }))._unsafeUnwrap();
  if (!preview.dryRun) throw new Error('Expected rollback preview');
  capture.mockResolvedValue(
    ok({
      ...state,
      tables: [
        {
          ...items,
          records: items.records.map((record) =>
            record.id === rowA ? { ...record, version: 13 } : record
          ),
        },
        ...rest,
      ],
    })
  );
  const rejected = await service.rollback(ctx, {
    baseId,
    revision: 1,
    confirmation: preview.confirmation,
  });
  expect(rejected._unsafeUnwrapErr().code).toBe('vcs.stale_rollback_preview');
  expect(push).toHaveBeenCalledTimes(1);
});

it('rejects an old preview after writes restore the same contents at the same revision', async () => {
  const { service, head, push } = harness({ kind: 'full', includesForeignBases: true });
  const state = { enabled: true, headRevision: 2, minRetainedSeq: 0, minRetainedXid: '0' };
  head.mockResolvedValue(ok({ ...state, modificationFence: '100.000001' }));
  push.mockResolvedValue(
    ok({
      ok: true,
      dryRun: true,
      baseId,
      baseRevision: 2,
      newRevision: 2,
      rebased: false,
      summary: summarizePatch(diffSnapshots(snapshot(2), snapshot(1))),
    })
  );
  const preview = (await service.rollback(ctx, { baseId, revision: 1 }))._unsafeUnwrap();
  if (!preview.dryRun) throw new Error('Expected rollback preview');
  head.mockResolvedValue(ok({ ...state, modificationFence: '100.000003' }));
  const rejected = await service.rollback(ctx, {
    baseId,
    revision: 1,
    confirmation: preview.confirmation,
  });
  expect(rejected._unsafeUnwrapErr().code).toBe('vcs.stale_rollback_preview');
  expect(push).toHaveBeenCalledTimes(1);
});

it('rejects a confirmation when a business write lands during online order preparation', async () => {
  const { service, capture, read, head, prepareOrders, push } = harness({
    kind: 'full',
    includesForeignBases: true,
  });
  const ordered = (revision: number, position: number): IBaseVcsSnapshot => {
    const original = snapshot(revision);
    const table = original.tables[0];
    return {
      ...original,
      tables: [{ ...table, records: [{ ...table.records[0], autoNumber: position }] }],
    };
  };
  const current = ordered(2, 3);
  const target = ordered(1, 1);
  capture.mockResolvedValue(ok(current));
  read.mockResolvedValue(ok(target));
  push.mockResolvedValue(
    ok({
      ok: true,
      dryRun: true,
      baseId,
      baseRevision: 2,
      newRevision: 2,
      rebased: false,
      summary: summarizePatch(diffSnapshots(current, target)),
    })
  );
  const preview = (await service.rollback(ctx, { baseId, revision: 1 }))._unsafeUnwrap();
  if (!preview.dryRun) throw new Error('Expected rollback preview');
  expect(prepareOrders).not.toHaveBeenCalled();
  prepareOrders.mockImplementation(async () => {
    head.mockResolvedValue(
      ok({
        enabled: true,
        headRevision: 2,
        minRetainedSeq: 0,
        minRetainedXid: '0',
        modificationFence: '100.000004',
      })
    );
    return ok(undefined);
  });
  const confirmed = await service.rollback(ctx, {
    baseId,
    revision: 1,
    confirmation: preview.confirmation,
  });
  expect(confirmed._unsafeUnwrapErr().code).toBe('vcs.stale_rollback_preview');
  expect(prepareOrders).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledTimes(1);
});

it.each(['shared', 'exclusive'] as const)(
  'acquires %s push coordination before opening the metadata transaction',
  async (mode) => {
    const table = currentTable();
    const { coordination, tx, head, lockMetadata, physical, findReceipt, queries } = harness(
      { kind: 'full' },
      table
    );
    const events: string[] = [];
    vi.spyOn(coordination, 'acquire').mockImplementationOnce(async (_, ids, actualMode) => {
      events.push('acquire');
      expect(ids).toEqual([tableId]);
      expect(actualMode).toBe(mode);
      return ok(
        createTableSchemaCoordinationLease(actualMode, ids, async () => {
          events.push('release');
        })
      );
    });
    const runBatch = tx.withBatchTransaction;
    tx.withBatchTransaction = async (context, work, options) => {
      events.push('begin');
      const result = await runBatch(context, work, options);
      events.push('end');
      return result;
    };
    const failure = domainError.conflict({ code: 'vcs.test_lock_failure', message: 'Lock failed' });
    physical.mockImplementationOnce(async () => {
      events.push('physical');
      return ok(undefined);
    });
    lockMetadata.mockImplementationOnce(async () => {
      events.push('metadata');
      return err(failure);
    });
    type Dependencies = ConstructorParameters<typeof PushVcsPatchService>;
    const base = Base.rehydrate({
      id: BaseId.create(baseId)._unsafeUnwrap(),
      name: BaseName.create('Inventory')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const assertCanApplyPatch = async () => {
      events.push('authorize');
      return ok(undefined);
    };
    const service = new PushVcsPatchService(
      { findOne: async () => ok(base) } as Dependencies[0],
      { execute: vi.fn() },
      queries,
      tx as Dependencies[3],
      {
        findCommitByOriginPushId: findReceipt,
        getHead: head,
        lockPushMetadata: lockMetadata,
        lockPushPhysicalTargets: physical,
      } as Dependencies[4],
      { assertCanApplyPatch } as Dependencies[5],
      {} as Dependencies[6],
      { prepareOrderColumn: vi.fn() },
      {} as Dependencies[8],
      coordination
    );
    const target = snapshot(1);
    const [items, ...rest] = target.tables;
    const patch = diffSnapshots(
      snapshot(2),
      mode === 'shared' ? target : { ...target, tables: [{ ...items, name: 'Renamed' }, ...rest] }
    );
    const result = await service.execute(ctx, { baseId, baseRevision: 2, patch });
    expect(result._unsafeUnwrapErr()).toEqual(failure);
    expect(events).toEqual([
      'authorize',
      'acquire',
      'begin',
      'authorize',
      'physical',
      'metadata',
      'end',
      'release',
    ]);

    const originPushId = 'concurrent-push';
    const committed: IVcsCommit = {
      baseId,
      originPushId,
      actorId: ctx.actorId.toString(),
      commitId: 'vcsc_original',
      revision: 3,
      parentRevision: 2,
      parents: [2],
      seqUpto: 10,
      createdAt: '2026-02-01T00:00:00Z',
      summary: summarizePatch(patch),
    };
    findReceipt.mockResolvedValueOnce(ok(null)).mockResolvedValueOnce(ok(committed));
    vi.spyOn(coordination, 'acquire').mockResolvedValueOnce(
      err(domainError.conflict({ code: 'schema_coordination.busy', message: 'Busy' }))
    );
    const replay = await service.execute(ctx, { baseId, baseRevision: 2, patch, originPushId });
    expect(replay._unsafeUnwrap()).toMatchObject({ commitId: committed.commitId, newRevision: 3 });
    expect(lockMetadata).toHaveBeenCalledOnce();
  }
);

it('coordinates live and historical tables before the confirmed rollback transaction', async () => {
  const { service, capture, coordination, lockMetadata, physical, push, readIds, tx } = harness({
    kind: 'full',
    includesForeignBases: true,
  });
  const live = snapshot(2);
  const [items, retained] = live.tables;
  capture.mockImplementation(async (_, _base, _revision, deletedIds) => {
    if (deletedIds) expect(deletedIds).toEqual([retained.id]);
    return ok({ ...live, tables: deletedIds ? [retained] : [items] });
  });
  const events: string[] = [];
  const baseAcquire = coordination.acquire.bind(coordination);
  vi.spyOn(coordination, 'acquire').mockImplementationOnce(async (_, ids, mode) => {
    events.push('acquire');
    expect(new Set(ids)).toEqual(new Set([tableId, retained.id]));
    expect(mode).toBe('exclusive');
    return ok(
      createTableSchemaCoordinationLease(mode, ids, async () => {
        events.push('release');
      })
    );
  });
  const runBatch = tx.withBatchTransaction;
  tx.withBatchTransaction = async (context, work, options) => {
    events.push('begin');
    const result = await runBatch(context, work, options);
    events.push('end');
    return result;
  };
  const summary = summarizePatch(diffSnapshots(snapshot(2), snapshot(1)));
  push.mockImplementation(async (context, raw, options) => {
    const request = pushVcsPatchInputSchema.parse(raw);
    if (!request.dryRun) {
      events.push('nested');
      expect(options?.restore?.tableIds).toEqual([retained.id]);
      const nested = (await baseAcquire(context, [retained.id], 'shared'))._unsafeUnwrap();
      const uncovered = await baseAcquire(context, [id('tbl', 'q')], 'exclusive');
      expect(uncovered._unsafeUnwrapErr().code).toBe('schema_coordination.busy');
      await nested.release();
      expect(events).not.toContain('release');
    }
    return ok({
      ok: true,
      dryRun: Boolean(request.dryRun),
      baseId,
      baseRevision: 2,
      newRevision: request.dryRun ? 2 : 3,
      commitId: options?.rollbackCommitId,
      rebased: false,
      summary,
    });
  });
  const preview = (await service.rollback(ctx, { baseId, revision: 1 }))._unsafeUnwrap();
  if (!preview.dryRun) throw new Error('Expected rollback preview');
  expect(readIds).not.toHaveBeenCalled();
  events.length = 0;
  physical.mockImplementationOnce(async () => {
    events.push('physical');
    return ok(undefined);
  });
  lockMetadata.mockImplementation(async () => {
    events.push('metadata');
    return ok({ enabled: true, headRevision: 2, minRetainedSeq: 0, minRetainedXid: '0' });
  });
  const confirmed = await service.rollback(ctx, {
    baseId,
    revision: 1,
    confirmation: preview.confirmation,
  });
  expect(confirmed._unsafeUnwrap()).toMatchObject({ dryRun: false, result: { newRevision: 3 } });
  expect(events).toEqual(['acquire', 'begin', 'physical', 'metadata', 'nested', 'end', 'release']);
});

it('passes only the winning attempt’s restore plan to the preview dry run', async () => {
  const { service, capture, push } = harness(
    { kind: 'full', includesForeignBases: true },
    currentTable(),
    { retryBatch: true }
  );
  const first = snapshot(2);
  const [items, retained] = first.tables;
  capture
    .mockResolvedValueOnce(ok({ ...first, tables: [items] }))
    .mockResolvedValueOnce(ok({ ...first, tables: [retained] }))
    .mockResolvedValueOnce(ok(first));
  push.mockResolvedValue(
    ok({
      ok: true,
      dryRun: true,
      baseId,
      baseRevision: 2,
      newRevision: 2,
      rebased: false,
      summary: summarizePatch(diffSnapshots(first, snapshot(1))),
    })
  );
  expect((await service.rollback(ctx, { baseId, revision: 1 }))._unsafeUnwrap().dryRun).toBe(true);
  expect(capture).toHaveBeenCalledTimes(3);
  expect(push).toHaveBeenCalledOnce();
  expect(push.mock.calls[0]?.[2]?.restore).toEqual({ tableIds: [], tableChanges: [] });
});
