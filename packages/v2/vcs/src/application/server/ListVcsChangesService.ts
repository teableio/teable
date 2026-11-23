import {
  v2CoreTokens,
  type DomainError,
  type IBaseRepository,
  type IExecutionContext,
  type IQueryBus,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { decodeVcsPullCursor } from '../../domain/cursor';
import { vcsDomainError } from '../../domain/errors';
import type {
  IBaseVcsAccessScope,
  IRecordVcsSnapshot,
  ITableAccessScope,
  ITableVcsSnapshot,
  IVcsIncrementalChanges,
  IVcsStoredChange,
  IVcsTableRecordDelta,
} from '../../domain/types';
import type {
  IBaseVcsLogRepository,
  IVcsAccessPolicy,
  IVcsReadableTableScope,
} from '../../ports/server';
import { v2VcsServerTokens } from '../../ports/tokens';
import { listSelectedTableRecordsForVcs } from '../../snapshot/tableToVcsSnapshot';
import type { CloneVcsSnapshotService } from './CloneVcsSnapshotService';
import {
  buildScopedTableSnapshot,
  isScopeRecordForbidden,
  resolveExistingBase,
} from './serverHelpers';

export interface IListVcsChangesInput {
  readonly baseId: string;
  readonly cursor: string;
  readonly sinceRevision?: number;
  readonly limit?: number;
  readonly tableIds?: readonly string[];
}

interface ICoalescedDirtyTables {
  readonly tableLifecycle: Map<string, 'upsert' | 'delete'>;
  readonly schemaDirtyTables: Set<string>;
  readonly recordOpsByTable: Map<string, Map<string, 'upsert' | 'delete'>>;
}

const DEFAULT_CHANGE_PAGE_LIMIT = 5000;

const applyTableDirtyKey = (state: ICoalescedDirtyTables, change: IVcsStoredChange): void => {
  if (change.opKind === 'delete') {
    state.tableLifecycle.set(change.tableId, 'delete');
    state.schemaDirtyTables.delete(change.tableId);
    state.recordOpsByTable.delete(change.tableId);
    return;
  }
  state.tableLifecycle.set(change.tableId, 'upsert');
  state.schemaDirtyTables.add(change.tableId);
};

const applyDirtyKeyToCoalescedState = (
  state: ICoalescedDirtyTables,
  change: IVcsStoredChange
): void => {
  if (change.entityType === 'table') {
    applyTableDirtyKey(state, change);
    return;
  }
  if (state.tableLifecycle.get(change.tableId) === 'delete') {
    return;
  }
  if (change.entityType === 'field' || change.entityType === 'view') {
    state.schemaDirtyTables.add(change.tableId);
    return;
  }
  if (change.entityType === 'record') {
    let tableRecords = state.recordOpsByTable.get(change.tableId);
    if (!tableRecords) {
      tableRecords = new Map<string, 'upsert' | 'delete'>();
      state.recordOpsByTable.set(change.tableId, tableRecords);
    }
    tableRecords.set(change.entityId, change.opKind === 'delete' ? 'delete' : 'upsert');
  }
};

const coalesceDirtyKeys = (
  changes: readonly IVcsStoredChange[],
  requestedTableIds?: readonly string[]
): ICoalescedDirtyTables => {
  const allowedFilter =
    requestedTableIds && requestedTableIds.length > 0 ? new Set(requestedTableIds) : undefined;
  const state: ICoalescedDirtyTables = {
    tableLifecycle: new Map<string, 'upsert' | 'delete'>(),
    schemaDirtyTables: new Set<string>(),
    recordOpsByTable: new Map<string, Map<string, 'upsert' | 'delete'>>(),
  };

  for (const change of changes) {
    if (!allowedFilter || allowedFilter.has(change.tableId)) {
      applyDirtyKeyToCoalescedState(state, change);
    }
  }

  return state;
};

const collectDeletedTableIds = (coalesced: ICoalescedDirtyTables): string[] => {
  const deleted: string[] = [];
  for (const [tableId, state] of coalesced.tableLifecycle.entries()) {
    if (state === 'delete') {
      deleted.push(tableId);
    }
  }
  return deleted.sort((a, b) => a.localeCompare(b));
};

@injectable()
export class ListVcsChangesService {
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: IBaseRepository,
    @inject(v2CoreTokens.queryBus)
    private readonly queryBus: IQueryBus,
    @inject(v2VcsServerTokens.logRepository)
    private readonly logRepository: IBaseVcsLogRepository,
    @inject(v2VcsServerTokens.accessPolicy)
    private readonly accessPolicy: IVcsAccessPolicy,
    private readonly cloneService: CloneVcsSnapshotService
  ) {}

  private async buildFullSyncResponse(
    ctx: IExecutionContext,
    input: IListVcsChangesInput,
    fallbackCursor?: string
  ): Promise<Result<IVcsIncrementalChanges, DomainError>> {
    const clonedRes = await this.cloneService.execute(ctx, {
      baseId: input.baseId,
      tableIds: input.tableIds,
    });
    if (clonedRes.isErr()) {
      return err(clonedRes.error);
    }
    const { snapshot } = clonedRes.value;
    const nextCursor = snapshot.cursor ?? fallbackCursor;
    return ok({
      baseId: snapshot.baseId,
      baseName: snapshot.baseName,
      fromRevision: input.sinceRevision ?? 0,
      toRevision: snapshot.revision,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      hasChanges: true,
      hasMore: false,
      requiresFullSync: true,
      fullSnapshot: snapshot,
      upsertedTables: [],
      deletedTableIds: [],
      recordDeltas: [],
      ...(snapshot.accessScope ? { accessScope: snapshot.accessScope } : {}),
    });
  }

  private async buildRecordDeltaForScope(
    ctx: IExecutionContext,
    scope: IVcsReadableTableScope,
    recordOps: Map<string, 'upsert' | 'delete'>
  ): Promise<Result<IVcsTableRecordDelta, DomainError>> {
    const upsertIds: string[] = [];
    const deleteIds = new Set<string>();
    for (const [recordId, op] of recordOps.entries()) {
      if (op === 'delete') {
        deleteIds.add(recordId);
      } else {
        upsertIds.push(recordId);
      }
    }

    let upserts: IRecordVcsSnapshot[] = [];
    if (!isScopeRecordForbidden(scope) && upsertIds.length > 0) {
      const recRes = await listSelectedTableRecordsForVcs(
        this.queryBus,
        ctx,
        scope.table,
        upsertIds,
        scope.queryScope
      );
      if (recRes.isErr()) {
        return err(recRes.error);
      }
      upserts = recRes.value;
      const foundIds = new Set(upserts.map((r) => r.id));
      for (const requestedId of upsertIds) {
        if (!foundIds.has(requestedId)) {
          deleteIds.add(requestedId);
        }
      }
    }

    upserts.sort((a, b) => a.id.localeCompare(b.id));
    const deletes = Array.from(deleteIds).sort((a, b) => a.localeCompare(b));
    return ok({
      tableId: scope.tableId,
      upserts,
      deletes,
    });
  }

  private async appendScopeIncrementalEntry(params: {
    readonly ctx: IExecutionContext;
    readonly scope: IVcsReadableTableScope;
    readonly coalesced: ICoalescedDirtyTables;
    readonly upsertedTables: ITableVcsSnapshot[];
    readonly recordDeltas: IVcsTableRecordDelta[];
    readonly accessScopeTables: Record<string, ITableAccessScope>;
  }): Promise<Result<void, DomainError>> {
    const { ctx, scope, coalesced, upsertedTables, recordDeltas, accessScopeTables } = params;
    const isSchemaDirty = coalesced.schemaDirtyTables.has(scope.tableId);
    const isWholeTableUpsert = coalesced.tableLifecycle.get(scope.tableId) === 'upsert';
    const recordOps = coalesced.recordOpsByTable.get(scope.tableId);

    if (scope.tableAccessScope) {
      accessScopeTables[scope.tableId] = scope.tableAccessScope;
    }

    if (isSchemaDirty) {
      const snapRes = await buildScopedTableSnapshot({
        queryBus: this.queryBus,
        context: ctx,
        scope,
        includeRecords: isWholeTableUpsert,
      });
      if (snapRes.isErr()) return err(snapRes.error);
      upsertedTables.push(snapRes.value);
    }

    if (!isWholeTableUpsert && recordOps && recordOps.size > 0) {
      const deltaRes = await this.buildRecordDeltaForScope(ctx, scope, recordOps);
      if (deltaRes.isErr()) return err(deltaRes.error);
      if (deltaRes.value.upserts.length > 0 || deltaRes.value.deletes.length > 0) {
        recordDeltas.push(deltaRes.value);
      }
    }

    return ok(undefined);
  }

  private async materializeIncrementalDeltas(
    ctx: IExecutionContext,
    baseId: Parameters<IVcsAccessPolicy['resolveReadableTables']>[1],
    changes: readonly IVcsStoredChange[],
    requestedTableIds?: readonly string[]
  ): Promise<
    Result<
      {
        readonly upsertedTables: ITableVcsSnapshot[];
        readonly deletedTableIds: string[];
        readonly recordDeltas: IVcsTableRecordDelta[];
        readonly accessScope?: IBaseVcsAccessScope;
      },
      DomainError
    >
  > {
    const coalesced = coalesceDirtyKeys(changes, requestedTableIds);
    const deletedTableIds = collectDeletedTableIds(coalesced);
    const dirtyTableIds = Array.from(
      new Set([...coalesced.schemaDirtyTables, ...coalesced.recordOpsByTable.keys()])
    );

    const upsertedTables: ITableVcsSnapshot[] = [];
    const recordDeltas: IVcsTableRecordDelta[] = [];
    const accessScopeTables: Record<string, ITableAccessScope> = {};

    if (dirtyTableIds.length === 0) {
      return ok({ upsertedTables, deletedTableIds, recordDeltas });
    }

    const scopesRes = await this.accessPolicy.resolveReadableTables(ctx, baseId, dirtyTableIds);
    if (scopesRes.isErr()) return err(scopesRes.error);

    for (const scope of scopesRes.value) {
      const stepRes = await this.appendScopeIncrementalEntry({
        ctx,
        scope,
        coalesced,
        upsertedTables,
        recordDeltas,
        accessScopeTables,
      });
      if (stepRes.isErr()) return err(stepRes.error);
    }

    const accessScope: IBaseVcsAccessScope | undefined =
      Object.keys(accessScopeTables).length > 0 ? { tables: accessScopeTables } : undefined;

    return ok({
      upsertedTables,
      deletedTableIds,
      recordDeltas,
      ...(accessScope ? { accessScope } : {}),
    });
  }

  async execute(
    ctx: IExecutionContext,
    input: IListVcsChangesInput
  ): Promise<Result<IVcsIncrementalChanges, DomainError>> {
    if (!input.cursor || !input.cursor.trim()) {
      return err(
        vcsDomainError.validation({
          code: 'vcs.cursor_required',
          message: 'Missing required VCS pull cursor',
        })
      );
    }

    const decodedCursor = decodeVcsPullCursor(input.cursor);
    if (!decodedCursor) {
      return err(
        vcsDomainError.validation({
          code: 'vcs.invalid_cursor',
          message: 'Invalid VCS pull cursor',
        })
      );
    }

    const resolved = await resolveExistingBase(this.baseRepository, ctx, input.baseId);
    if (resolved.isErr()) {
      return err(resolved.error);
    }
    const { baseId, base } = resolved.value;

    const enabledRes = await this.logRepository.isEnabled(ctx, baseId);
    if (enabledRes.isErr()) {
      return err(enabledRes.error);
    }
    if (!enabledRes.value) {
      return this.buildFullSyncResponse(ctx, input);
    }

    const pageRes = await this.logRepository.listChangesSince(
      ctx,
      baseId,
      decodedCursor,
      input.limit ?? DEFAULT_CHANGE_PAGE_LIMIT,
      input.tableIds && input.tableIds.length > 0 ? { tableIds: input.tableIds } : undefined
    );
    if (pageRes.isErr()) {
      return err(pageRes.error);
    }

    const page = pageRes.value;
    if (page.requiresFullSync) {
      return this.buildFullSyncResponse(ctx, input, page.encodedCursor);
    }

    const baseName = base.name().toString();
    const fromRevision = input.sinceRevision ?? 0;

    if (page.changes.length === 0) {
      return ok({
        baseId: baseId.toString(),
        baseName,
        fromRevision,
        toRevision: page.headRevision,
        nextCursor: page.encodedCursor,
        hasChanges: false,
        hasMore: Boolean(page.hasMore),
        originPushIds: page.originPushIds,
        requiresFullSync: false,
        upsertedTables: [],
        deletedTableIds: [],
        recordDeltas: [],
      });
    }

    const matRes = await this.materializeIncrementalDeltas(
      ctx,
      baseId,
      page.changes,
      input.tableIds
    );
    if (matRes.isErr()) {
      return err(matRes.error);
    }
    const mat = matRes.value;
    const hasMaterializedChanges =
      mat.upsertedTables.length > 0 ||
      mat.deletedTableIds.length > 0 ||
      mat.recordDeltas.length > 0;

    return ok({
      baseId: baseId.toString(),
      baseName,
      fromRevision,
      toRevision: page.headRevision,
      nextCursor: page.encodedCursor,
      hasChanges: hasMaterializedChanges,
      hasMore: Boolean(page.hasMore),
      originPushIds: page.originPushIds,
      requiresFullSync: false,
      upsertedTables: mat.upsertedTables,
      deletedTableIds: mat.deletedTableIds,
      recordDeltas: mat.recordDeltas,
      ...(mat.accessScope ? { accessScope: mat.accessScope } : {}),
    });
  }
}
