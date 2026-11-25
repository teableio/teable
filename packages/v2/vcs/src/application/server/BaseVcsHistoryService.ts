import { createHash } from 'node:crypto';
import {
  getUnitOfWorkTransaction,
  resolveScopedTableSchemaLease,
  Table,
  TableId,
  type BaseId,
  type DomainError,
  type IDomainWriteTransaction,
  type IExecutionContext,
  type IQueryBus,
  type ITableRepository,
  type LinkField,
} from '@teable/v2-core';
import { err, ok, Result } from 'neverthrow';

import { diffSnapshots, summarizePatch } from '../../domain/diffSnapshots';
import { vcsDomainError, vcsWriteBusyError } from '../../domain/errors';
import { canonicalizeRecord, canonicalizeTable } from '../../domain/fieldClassification';
import type {
  IBaseVcsPatch,
  IBaseVcsPatchSummary,
  IBaseVcsSnapshot,
  IVcsPushResult,
} from '../../domain/types';
import type {
  IBaseVcsLogRepository,
  IVcsAccessPolicy,
  IVcsRevisionComparison,
  IVcsRollbackRestore,
  VcsHistoryAccess,
} from '../../ports/server';
import {
  containsForeignReferences,
  projectBaseOnlySnapshot,
  projectHistoricalSnapshot,
  readHistoryVisibility,
} from './historyProjection';
import type { PushVcsPatchService } from './PushVcsPatchService';
import { listLiveTablesInBase, parseBaseId } from './serverHelpers';

interface IRevisionInput {
  readonly baseId: string;
  readonly revision: number;
}
interface IDiffInput {
  readonly baseId: string;
  readonly from: number;
  readonly to: number;
}
type IDiffInputResult = Pick<IDiffInput, 'from' | 'to'>;
interface IRollbackInput extends IRevisionInput {
  readonly confirmation?: string;
  readonly originPushId?: string;
}
interface IRollbackPreview {
  readonly dryRun: true;
  readonly revision: number;
  readonly headRevision: number;
  readonly confirmation: string;
  readonly patch: IBaseVcsPatch;
  readonly summary: IBaseVcsPatchSummary;
}
type Rollback = IRollbackPreview | { readonly dryRun: false; readonly result: IVcsPushResult };
type RollbackPreparation =
  | { readonly preview: IRollbackPreview; readonly restore: IVcsRollbackRestore }
  | { readonly dryRun: false; readonly result: IVcsPushResult }
  | { readonly orderColumns: Map<string, Set<string>> };

const historyForbidden = () =>
  vcsDomainError.forbidden({
    code: 'vcs.history_forbidden',
    message: 'This operation requires access to the complete historical data.',
  });
const invalidRevision = () =>
  vcsDomainError.validation({
    code: 'vcs.invalid_revision',
    message: 'A revision must be a nonnegative safe integer.',
  });
const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 0;

function rollbackReceipt(input: IRollbackInput, actorId: string) {
  if (input.confirmation === undefined) return undefined;
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        input.baseId,
        actorId,
        input.revision,
        input.confirmation,
        input.originPushId ?? null,
      ])
    )
    .digest('hex');
  // Public push messages and origin IDs are caller-controlled. Only the server can set a commit ID.
  return { commitId: `vcsr_${hash}`, originPushId: input.originPushId ?? `rollback_${hash}` };
}

function rollbackConfirmation(
  actor: string,
  revision: number,
  live: IBaseVcsSnapshot,
  modificationFence: string | undefined,
  restoredTableIds: readonly string[]
): string {
  const hash = createHash('sha256');
  // Each JSON value is one framed unit. Records are hashed individually so the
  // maximum serialized value is one row or table schema, even for large bases.
  const append = (value: unknown) => hash.update(JSON.stringify(value)).update('\n');
  append(['base-vcs-rollback-v4', actor, live.baseId, live.revision, revision, modificationFence]);
  if (restoredTableIds.length) append(['restore', [...restoredTableIds].sort()]);
  for (const table of [...live.tables].sort((a, b) => a.id.localeCompare(b.id))) {
    append(canonicalizeTable({ ...table, records: [] }));
    for (const record of [...table.records].sort((a, b) => a.id.localeCompare(b.id))) {
      const row = canonicalizeRecord(record, table.fields, { preserveComputed: true });
      // Publishing a lazy order column copies autoNumber. Hash the observable order
      // so that publishing it between confirmation checks preserves the user's plan.
      if (row.orders) {
        const overrides = Object.entries(row.orders).filter(
          ([, order]) => order !== row.autoNumber
        );
        append({ ...row, orders: overrides.length ? Object.fromEntries(overrides) : undefined });
      } else {
        append(row);
      }
    }
  }
  return hash.digest('hex');
}

function missingOrderColumns(
  observed: IBaseVcsSnapshot,
  patch: IBaseVcsPatch,
  restore: IVcsRollbackRestore
): Map<string, Set<string>> {
  const targets = new Map<string, Set<string>>();
  for (const changes of [...patch.tablesUpdated, ...restore.tableChanges]) {
    const views = new Set<string>();
    for (const record of changes.recordsUpdated) {
      for (const change of record.orderChanges ?? []) views.add(change.viewId);
    }
    for (const record of changes.recordsAdded) {
      for (const viewId of Object.keys(record.orders ?? {})) views.add(viewId);
    }
    if (!views.size) continue;
    // Published order columns are backfilled across the whole table. An empty
    // table needs the idempotent adapter check before its first ordered insert.
    const orders = observed.tables.find((table) => table.id === changes.tableId)?.records[0]
      ?.orders;
    for (const view of views) {
      if (orders?.[view] !== undefined) views.delete(view);
    }
    if (views.size) targets.set(changes.tableId, views);
  }
  return targets;
}

export class BaseVcsHistoryService {
  constructor(
    private readonly log: Pick<
      IBaseVcsLogRepository,
      | 'readHistoricalSnapshot'
      | 'readHistoricalTableIds'
      | 'compareHistoricalRevisions'
      | 'getHead'
      | 'lockPushMetadata'
      | 'lockPushPhysicalTargets'
      | 'findCommitByOriginPushId'
    >,
    private readonly access: Pick<IVcsAccessPolicy, 'resolveHistoryAccess' | 'assertCanApplyPatch'>,
    private readonly queries: IQueryBus,
    private readonly checkpoints: {
      capture(
        ctx: IExecutionContext,
        baseId: BaseId,
        revision: number,
        deletedTableIds?: readonly string[]
      ): Promise<Result<IBaseVcsSnapshot, DomainError>>;
    },
    private readonly transactions: Pick<IDomainWriteTransaction, 'withBatchTransaction'>,
    private readonly push: Pick<
      PushVcsPatchService,
      'execute' | 'prepareRollbackOrderColumns' | 'withWriteCoordination'
    >,
    private readonly tables: Pick<ITableRepository, 'find'>
  ) {}

  private readScopedVisibility(
    ctx: IExecutionContext,
    grant: Extract<VcsHistoryAccess, { kind: 'scoped' }>,
    snapshots: readonly IBaseVcsSnapshot[]
  ) {
    let tables = grant.tables;
    // A diff needs a grant at both endpoints. Removing a table on just one side would
    // turn a retention boundary into a spurious table addition or deletion.
    if (tables.some((scope) => scope.recordHistoryOnly)) {
      const window = grant.recordHistoryWindow;
      const inWindow =
        window &&
        snapshots.every(({ capturedAt }) => {
          const time = Date.parse(capturedAt);
          return time <= window.endMs && (window.startMs === undefined || time >= window.startMs);
        });
      if (!inWindow) tables = tables.filter((scope) => !scope.recordHistoryOnly);
    }
    return readHistoryVisibility(ctx, this.queries, tables, snapshots);
  }

  async checkout(
    ctx: IExecutionContext,
    { baseId, revision }: IRevisionInput
  ): Promise<
    Result<
      {
        snapshot: IBaseVcsSnapshot;
        remoteMode: 'v2-vcs';
      },
      DomainError
    >
  > {
    if (!validRevision(revision)) return err(invalidRevision());
    const id = parseBaseId(baseId);
    if (id.isErr()) return err(id.error);
    if (!this.access.resolveHistoryAccess) return err(historyForbidden());
    const grant = await this.access.resolveHistoryAccess(ctx, id.value);
    if (grant.isErr()) return err(grant.error);
    const stored = await this.log.readHistoricalSnapshot(ctx, id.value, revision);
    if (stored.isErr()) return err(stored.error);
    if (grant.value.kind === 'full') {
      const snapshot = grant.value.includesForeignBases
        ? stored.value
        : projectBaseOnlySnapshot(stored.value);
      return ok({ snapshot, remoteMode: 'v2-vcs' });
    }
    const visibility = await this.readScopedVisibility(ctx, grant.value, [stored.value]);
    if (visibility.isErr()) return err(visibility.error);
    return ok({
      snapshot: projectHistoricalSnapshot(
        stored.value,
        visibility.value,
        grant.value.currentBaseName
      ),
      remoteMode: 'v2-vcs',
    });
  }

  async diff(
    ctx: IExecutionContext,
    { baseId, from, to }: IDiffInput
  ): Promise<
    Result<
      Pick<IVcsRevisionComparison, 'patch' | 'summary' | 'mergeBase'> & IDiffInputResult,
      DomainError
    >
  > {
    if (!validRevision(from) || !validRevision(to)) return err(invalidRevision());
    const id = parseBaseId(baseId);
    if (id.isErr()) return err(id.error);
    if (!this.access.resolveHistoryAccess) return err(historyForbidden());
    const grant = await this.access.resolveHistoryAccess(ctx, id.value);
    if (grant.isErr()) return err(grant.error);
    const compared = await this.log.compareHistoricalRevisions(ctx, id.value, from, to);
    if (compared.isErr()) return err(compared.error);
    const {
      patch: rawPatch,
      summary,
      mergeBase,
      containsForeignReferences: foreign,
    } = compared.value;
    if (from === to) {
      const patch: IBaseVcsPatch = { tablesAdded: [], tablesUpdated: [], tablesDeleted: [] };
      return ok({ from, to, mergeBase, patch, summary: summarizePatch(patch) });
    }
    if (grant.value.kind === 'full' && (grant.value.includesForeignBases || foreign === false)) {
      return ok({ from, to, mergeBase, patch: rawPatch, summary });
    }
    const candidates =
      grant.value.kind === 'scoped' ? compared.value.projectionCandidates : undefined;
    const left = candidates
      ? ok(candidates.before)
      : await this.log.readHistoricalSnapshot(ctx, id.value, from);
    if (left.isErr()) return err(left.error);
    const right = candidates
      ? ok(candidates.after)
      : await this.log.readHistoricalSnapshot(ctx, id.value, to);
    if (right.isErr()) return err(right.error);
    let before: IBaseVcsSnapshot;
    let after: IBaseVcsSnapshot;
    if (grant.value.kind === 'full') {
      if (
        foreign !== true &&
        !containsForeignReferences(left.value) &&
        !containsForeignReferences(right.value)
      ) {
        return ok({ from, to, mergeBase, patch: rawPatch, summary });
      }
      // Apply the same projection to both endpoints when a foreign link was added or removed.
      before = projectBaseOnlySnapshot(left.value, true);
      after = projectBaseOnlySnapshot(right.value, true);
    } else {
      const visibility = await this.readScopedVisibility(ctx, grant.value, [
        left.value,
        right.value,
      ]);
      if (visibility.isErr()) return err(visibility.error);
      before = projectHistoricalSnapshot(left.value, visibility.value);
      after = projectHistoricalSnapshot(right.value, visibility.value);
    }
    const patch = diffSnapshots(before, after, { accessScope: { tables: {} } });
    return ok({
      from,
      to,
      mergeBase: compared.value.mergeBase,
      patch,
      summary: summarizePatch(patch),
    });
  }

  private async lockRollbackTables(
    ctx: IExecutionContext,
    id: BaseId,
    historicalTableIds: readonly string[],
    includesForeignBases: boolean,
    waitForFirstTarget: boolean
  ): Promise<Result<void, DomainError>> {
    const tables = await listLiveTablesInBase(this.queries, ctx, id);
    if (tables.isErr()) return err(tables.error);
    const localIds = new Set(tables.value.map((table) => table.id().toString()));
    const deletedIds = historicalTableIds.filter((tableId) => !localIds.has(tableId));
    const coverage = resolveScopedTableSchemaLease(ctx, [...localIds, ...deletedIds], 'exclusive');
    if (coverage?.isErr()) return err(coverage.error);
    let retained: readonly Table[] = [];
    if (deletedIds.length > 0) {
      const ids = Result.combine(deletedIds.map((tableId) => TableId.create(tableId)));
      if (ids.isErr()) return err(ids.error);
      const spec = Table.specs(id).byIds(ids.value).build();
      if (spec.isErr()) return err(spec.error);
      const found = await this.tables.find(ctx, spec.value, { state: 'deleted' });
      if (found.isErr()) return err(found.error);
      retained = found.value;
      for (const table of retained) localIds.add(table.id().toString());
    }
    const names = new Set<string>();
    for (const table of [...tables.value, ...retained]) {
      const name = table.dbTableName().andThen((n) => n.value());
      if (name.isErr()) return err(name.error);
      names.add(name.value);
      for (const field of table.getFields()) {
        if (field.type().toString() !== 'link') continue;
        const link = field as LinkField;
        const foreignBase = link.baseId();
        if (
          !includesForeignBases &&
          ((foreignBase && !foreignBase.equals(id)) ||
            !localIds.has(link.foreignTableId().toString()))
        ) {
          return err(historyForbidden());
        }
        const host = link.fkHostTableNameString();
        if (host.isErr()) return err(host.error);
        names.add(host.value);
      }
    }
    return this.log.lockPushPhysicalTargets(
      ctx,
      id,
      [...names].map((dbTableName) => ({ dbTableName })),
      { waitForFirstTarget }
    );
  }

  async rollback(
    ctx: IExecutionContext,
    input: IRollbackInput
  ): Promise<Result<Rollback, DomainError>> {
    return this.rollbackAttempt(ctx, input, false);
  }

  private async rollbackAttempt(
    ctx: IExecutionContext,
    input: IRollbackInput,
    columnsPrepared: boolean
  ): Promise<Result<Rollback, DomainError>> {
    if (!validRevision(input.revision)) return err(invalidRevision());
    const id = parseBaseId(input.baseId);
    if (id.isErr()) return err(id.error);
    const resolveAccess = this.access.resolveHistoryAccess?.bind(this.access);
    if (!resolveAccess) return err(historyForbidden());
    const initial = await resolveAccess(ctx, id.value);
    if (initial.isErr()) return err(initial.error);
    if (initial.value.kind !== 'full') return err(historyForbidden());
    const receipt = rollbackReceipt(input, ctx.actorId.toString());

    const runBatch = (
      context: IExecutionContext,
      historicalTableIds: readonly string[] = [],
      preflightError?: DomainError
    ) => {
      const borrowedTransaction = Boolean(
        getUnitOfWorkTransaction(context, 'data') || getUnitOfWorkTransaction(context, 'meta')
      );
      const work = async (
        tx: IExecutionContext
      ): Promise<Result<RollbackPreparation, DomainError>> => {
        let head = await this.log.getHead(
          tx,
          id.value,
          receipt ? { requireAtomicStorage: true } : undefined
        );
        if (head.isErr()) return err(head.error);
        if (!head.value.enabled) {
          return err(
            vcsDomainError.conflict({
              code: 'vcs.not_enabled',
              message: 'Base VCS is not enabled.',
            })
          );
        }
        const grant = await resolveAccess(tx, id.value);
        if (grant.isErr()) return err(grant.error);
        if (grant.value.kind !== 'full') return err(historyForbidden());
        if (receipt) {
          const previous = await this.log.findCommitByOriginPushId(
            tx,
            id.value,
            receipt.originPushId
          );
          if (previous.isErr()) return err(previous.error);
          const commit = previous.value;
          if (commit) {
            if (
              commit.commitId !== receipt.commitId ||
              commit.baseId !== input.baseId ||
              commit.actorId !== tx.actorId.toString() ||
              commit.originPushId !== receipt.originPushId
            ) {
              return err(
                vcsDomainError.conflict({
                  code: 'vcs.origin_push_id_used',
                  message: 'The origin push ID belongs to another operation.',
                })
              );
            }
            return ok({
              dryRun: false,
              result: {
                ok: true,
                dryRun: false,
                baseId: commit.baseId,
                baseRevision: commit.parentRevision,
                newRevision: commit.revision,
                commitId: commit.commitId,
                originPushId: receipt.originPushId,
                rebased: false,
                summary: commit.summary,
              },
            });
          }
        }
        if (preflightError) return err(preflightError);
        if (receipt) {
          const locked = await this.lockRollbackTables(
            tx,
            id.value,
            historicalTableIds,
            grant.value.includesForeignBases === true,
            !borrowedTransaction
          );
          if (locked.isErr()) return err(locked.error);
          head = await this.log.lockPushMetadata(tx, id.value, {
            tableIds: historicalTableIds,
            fieldIds: [],
            viewIds: [],
          });
          if (head.isErr()) return err(head.error);
          if (borrowedTransaction) {
            const rechecked = await this.lockRollbackTables(
              tx,
              id.value,
              historicalTableIds,
              grant.value.includesForeignBases === true,
              false
            );
            if (rechecked.isErr()) return err(rechecked.error);
          }
        }
        const headRevision = head.value.headRevision;
        const live = await this.checkpoints.capture(tx, id.value, headRevision);
        if (live.isErr()) return err(live.error);
        const target = await this.log.readHistoricalSnapshot(tx, id.value, input.revision);
        if (target.isErr()) return err(target.error);
        if (
          !grant.value.includesForeignBases &&
          (containsForeignReferences(live.value) || containsForeignReferences(target.value))
        )
          return err(historyForbidden());

        const patch = diffSnapshots(live.value, target.value);
        let observed = live.value;
        let restore: IVcsRollbackRestore = { tableIds: [], tableChanges: [] };
        if (patch.tablesAdded.length) {
          const retained = await this.checkpoints.capture(
            tx,
            id.value,
            headRevision,
            patch.tablesAdded.map((table) => table.id)
          );
          if (retained.isErr()) return err(retained.error);
          const tables = retained.value.tables;
          observed = { ...live.value, tables: [...live.value.tables, ...tables] };
          if (!grant.value.includesForeignBases && containsForeignReferences(observed)) {
            return err(historyForbidden());
          }
          restore = {
            tableIds: tables.map((table) => table.id),
            tableChanges: diffSnapshots(retained.value, {
              ...target.value,
              tables: patch.tablesAdded,
            }).tablesUpdated,
          };
        }
        const allowed = await this.access.assertCanApplyPatch(tx, id.value, patch, restore);
        if (allowed.isErr()) return err(allowed.error);
        // Field deletion patches have no cell before-images. Bind even those values, record
        // versions, orders and membership. Capture time and query order are not live state.
        const confirmation = rollbackConfirmation(
          ctx.actorId.toString(),
          input.revision,
          observed,
          head.value.modificationFence,
          restore.tableIds
        );
        if (!receipt) {
          return ok({
            preview: {
              dryRun: true,
              headRevision,
              revision: input.revision,
              confirmation,
              patch,
              summary: summarizePatch(patch),
            },
            restore,
          });
        }
        if (input.confirmation !== confirmation)
          return err(
            vcsDomainError.conflict({
              code: 'vcs.stale_rollback_preview',
              message: 'Rollback inputs changed. Preview the rollback again.',
            })
          );
        if (!columnsPrepared) {
          const orderColumns = missingOrderColumns(observed, patch, restore);
          if (orderColumns.size) return ok({ orderColumns });
        }
        const pushOptions = { requireExactHead: true, rollbackCommitId: receipt.commitId, restore };
        const applied = await this.push.execute(
          tx,
          {
            baseId: input.baseId,
            baseRevision: headRevision,
            patch,
            originPushId: receipt.originPushId,
            message: `Rollback to revision ${input.revision}`,
          },
          pushOptions
        );
        if (applied.isErr()) return err(applied.error);
        if (applied.value.commitId !== receipt.commitId)
          return err(
            vcsDomainError.invariant({
              code: 'vcs.rollback_receipt_missing',
              message: 'Push did not persist the rollback receipt in this transaction.',
            })
          );
        return ok({ dryRun: false, result: applied.value });
      };
      return this.transactions.withBatchTransaction(context, work, {
        scope: 'data',
        isolationLevel: receipt ? 'serializable' : 'repeatable read',
        onRetryExhausted: vcsWriteBusyError,
      });
    };

    let prepared: Result<RollbackPreparation, DomainError>;
    if (!receipt) {
      prepared = await runBatch(ctx);
    } else {
      const previous = await this.log.findCommitByOriginPushId(ctx, id.value, receipt.originPushId);
      if (previous.isErr()) return err(previous.error);
      if (previous.value) {
        // An immutable receipt can be verified without locking live tables or the head.
        prepared = await runBatch(
          ctx,
          [],
          vcsDomainError.conflict({
            code: 'vcs.stale_rollback_preview',
            message: 'Rollback inputs changed. Preview the rollback again.',
          })
        );
      } else {
        const target = await this.log.readHistoricalTableIds(ctx, id.value, input.revision);
        if (target.isErr()) {
          // A receipt committed since preflight still takes precedence over history retention.
          prepared = await runBatch(ctx, [], target.error);
        } else {
          const live = await listLiveTablesInBase(this.queries, ctx, id.value);
          if (live.isErr()) return err(live.error);
          const liveIds = live.value.map((table) => table.id().toString());
          const targetIds = new Set(target.value);
          prepared = await this.push.withWriteCoordination(
            ctx,
            [...liveIds, ...targetIds],
            liveIds.filter((tableId) => !targetIds.has(tableId)),
            'exclusive',
            (context) => runBatch(context, target.value)
          );
          if (prepared.isErr() && prepared.error.code === 'schema_coordination.busy') {
            // A competing confirmation may have committed while this caller waited for the lease.
            prepared = await runBatch(ctx, [], prepared.error);
          }
        }
      }
    }
    if (prepared.isErr()) return err(prepared.error);
    if ('orderColumns' in prepared.value) {
      // Online DDL must run after releasing the transaction's physical locks.
      const columns = await this.push.prepareRollbackOrderColumns(
        ctx,
        id.value,
        prepared.value.orderColumns
      );
      if (columns.isErr()) return err(columns.error);
      return this.rollbackAttempt(ctx, input, true);
    }
    if (!('preview' in prepared.value)) return ok(prepared.value);
    const { preview, restore } = prepared.value;

    // Push dry-run deliberately rolls back its batch. Give it its own transaction so its
    // rollback sentinel cannot poison the transaction which prepared the preview.
    const checked = await this.push.execute(
      ctx,
      {
        baseId: input.baseId,
        baseRevision: preview.headRevision,
        patch: preview.patch,
        dryRun: true,
      },
      { requireExactHead: true, restore }
    );
    if (checked.isErr()) return err(checked.error);
    return ok(preview);
  }
}
