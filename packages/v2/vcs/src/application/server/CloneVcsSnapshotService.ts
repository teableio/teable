import {
  v2CoreTokens,
  type BaseId,
  type DomainError,
  type IBaseRepository,
  type IExecutionContext,
  type IQueryBus,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { encodeVcsPullCursor } from '../../domain/cursor';
import { canonicalizeSnapshot } from '../../domain/fieldClassification';
import type {
  IBaseVcsAccessScope,
  IBaseVcsSnapshot,
  ITableAccessScope,
  ITableVcsSnapshot,
  IVcsHeadInfo,
} from '../../domain/types';
import type { IBaseVcsLogRepository, IVcsAccessPolicy } from '../../ports/server';
import { v2VcsServerTokens } from '../../ports/tokens';
import { buildScopedTableSnapshot, resolveExistingBase } from './serverHelpers';

export interface ICloneVcsSnapshotInput {
  readonly baseId: string;
  readonly tableIds?: readonly string[];
  readonly includeRecords?: boolean;
}

export interface ICloneVcsSnapshotOutput {
  readonly snapshot: IBaseVcsSnapshot;
  readonly remoteMode: IVcsHeadInfo['remoteMode'];
}

@injectable()
export class CloneVcsSnapshotService {
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: IBaseRepository,
    @inject(v2CoreTokens.queryBus)
    private readonly queryBus: IQueryBus,
    @inject(v2VcsServerTokens.logRepository)
    private readonly logRepository: IBaseVcsLogRepository,
    @inject(v2VcsServerTokens.accessPolicy)
    private readonly accessPolicy: IVcsAccessPolicy
  ) {}

  private async captureCursorIfEnabled(
    ctx: IExecutionContext,
    baseId: BaseId,
    vcsEnabled: boolean,
    tableIds?: readonly string[]
  ): Promise<Result<string | undefined, DomainError>> {
    if (!vcsEnabled) {
      return ok(undefined);
    }
    const cursorOptions = tableIds && tableIds.length > 0 ? { tableIds } : undefined;
    const cursorRes = await this.logRepository.capturePullCursor(ctx, baseId, cursorOptions);
    if (cursorRes.isErr()) {
      return err(cursorRes.error);
    }
    return ok(encodeVcsPullCursor(cursorRes.value));
  }

  private async collectScopedTables(
    ctx: IExecutionContext,
    baseId: BaseId,
    tableIds?: readonly string[],
    includeRecords = true
  ): Promise<
    Result<
      {
        readonly snapshotTables: ITableVcsSnapshot[];
        readonly accessScope?: IBaseVcsAccessScope;
      },
      DomainError
    >
  > {
    const scopesRes = await this.accessPolicy.resolveReadableTables(ctx, baseId, tableIds);
    if (scopesRes.isErr()) {
      return err(scopesRes.error);
    }

    const snapshotTables: ITableVcsSnapshot[] = [];
    const accessScopeTables: Record<string, ITableAccessScope> = {};

    for (const scope of scopesRes.value) {
      const tableSnapRes = await buildScopedTableSnapshot({
        queryBus: this.queryBus,
        context: ctx,
        scope,
        includeRecords,
      });
      if (tableSnapRes.isErr()) {
        return err(tableSnapRes.error);
      }
      snapshotTables.push(tableSnapRes.value);
      if (scope.tableAccessScope) {
        accessScopeTables[scope.tableId] = scope.tableAccessScope;
      }
    }

    const accessScope: IBaseVcsAccessScope | undefined =
      Object.keys(accessScopeTables).length > 0 ? { tables: accessScopeTables } : undefined;
    return ok({ snapshotTables, accessScope });
  }

  async execute(
    ctx: IExecutionContext,
    input: ICloneVcsSnapshotInput
  ): Promise<Result<ICloneVcsSnapshotOutput, DomainError>> {
    const resolved = await resolveExistingBase(this.baseRepository, ctx, input.baseId);
    if (resolved.isErr()) {
      return err(resolved.error);
    }
    const { baseId, base } = resolved.value;

    const headRes = await this.logRepository.getHead(ctx, baseId);
    if (headRes.isErr()) {
      return err(headRes.error);
    }
    const vcsEnabled = headRes.value.enabled;

    const cursorRes = await this.captureCursorIfEnabled(ctx, baseId, vcsEnabled, input.tableIds);
    if (cursorRes.isErr()) {
      return err(cursorRes.error);
    }

    const scopedRes = await this.collectScopedTables(
      ctx,
      baseId,
      input.tableIds,
      input.includeRecords !== false
    );
    if (scopedRes.isErr()) {
      return err(scopedRes.error);
    }

    const remoteMode: IVcsHeadInfo['remoteMode'] = vcsEnabled ? 'v2-vcs' : 'openapi-readonly';
    const snapshot = canonicalizeSnapshot(
      {
        formatVersion: 1,
        baseId: baseId.toString(),
        baseName: base.name().toString(),
        revision: vcsEnabled ? headRes.value.headRevision : 0,
        ...(cursorRes.value !== undefined ? { cursor: cursorRes.value } : {}),
        capturedAt: new Date().toISOString(),
        tables: scopedRes.value.snapshotTables,
        ...(scopedRes.value.accessScope ? { accessScope: scopedRes.value.accessScope } : {}),
      },
      { preserveComputed: true }
    );

    return ok({
      snapshot,
      remoteMode,
    });
  }
}
