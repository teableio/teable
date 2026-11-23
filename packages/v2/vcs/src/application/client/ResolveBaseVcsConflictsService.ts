import type { DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { diffSnapshots, isEmptyPatch } from '../../domain/diffSnapshots';
import { vcsDomainError } from '../../domain/errors';
import { canonicalizeSnapshot } from '../../domain/fieldClassification';
import { resolveConflicts } from '../../domain/resolveConflicts';
import type {
  IBaseVcsSnapshot,
  IVcsConflict,
  IVcsConflictResolution,
  IVcsMergeState,
} from '../../domain/types';
import { v2VcsClientTokens, type IVcsLocalEnginePort, type IVcsStateRepository } from '../../ports';
import {
  EAGER_RETURN_SNAPSHOT_RECORD_LIMIT,
  loadIndexedWorkspaceDiff,
  runWithEngineSession,
} from './workspaceHelpers';

export interface IResolveBaseVcsConflictsInput {
  readonly resolutions: Record<string, IVcsConflictResolution>;
  readonly includeSnapshot?: boolean;
}

export interface IResolveBaseVcsConflictsOutput {
  readonly remainingConflicts: readonly IVcsConflict[];
  readonly resolvedCount: number;
  readonly workingSnapshot: IBaseVcsSnapshot;
}

@injectable()
export class ResolveBaseVcsConflictsService {
  constructor(
    @inject(v2VcsClientTokens.localEngine)
    private readonly localEngine: IVcsLocalEnginePort,
    @inject(v2VcsClientTokens.stateRepository)
    private readonly stateRepository: IVcsStateRepository
  ) {}

  private async hydrateResolvedSnapshot(
    resolvedSnapshot: IBaseVcsSnapshot,
    mergeState: IVcsMergeState
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    const hydrateRes = await this.localEngine.hydrateSnapshot(resolvedSnapshot);
    if (hydrateRes.isErr()) return err(hydrateRes.error);
    if (!hydrateRes.value.snapshot) {
      return ok(resolvedSnapshot);
    }

    return ok(
      canonicalizeSnapshot(
        {
          ...hydrateRes.value.snapshot,
          revision: mergeState.theirsSnapshot.revision,
          ...(mergeState.theirsSnapshot.accessScope
            ? { accessScope: mergeState.theirsSnapshot.accessScope }
            : {}),
        },
        { preserveComputed: true }
      )
    );
  }

  private async readStoredTotalRecords(): Promise<number> {
    if (!this.stateRepository.readBaseSchemaSnapshot) {
      return 0;
    }
    const schemaRes = await this.stateRepository.readBaseSchemaSnapshot();
    return schemaRes.isOk() && schemaRes.value ? schemaRes.value.totalRecords : 0;
  }

  private async finalizeResolvedEngineSnapshot(
    engine: IVcsLocalEnginePort,
    params: {
      readonly baseId: string;
      readonly baseName: string;
      readonly resolvedSnapshot: IBaseVcsSnapshot;
      readonly mergeState: IVcsMergeState;
      readonly includeSnapshot?: boolean;
    }
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    if (engine.ensureWorkingTrackingTriggers) {
      const trigRes = await engine.ensureWorkingTrackingTriggers(params.baseId);
      if (trigRes.isErr()) return err(trigRes.error);
    }

    const totalRecords = await this.readStoredTotalRecords();
    const shouldCaptureFull =
      params.includeSnapshot === true ||
      (params.includeSnapshot !== false && totalRecords <= EAGER_RETURN_SNAPSHOT_RECORD_LIMIT);
    if (!shouldCaptureFull) {
      return ok(params.resolvedSnapshot);
    }

    const capRes = await engine.captureSnapshot(params.baseId, {
      baseName: params.baseName,
      revision: params.mergeState.theirsSnapshot.revision,
    });
    if (capRes.isErr()) return err(capRes.error);
    return ok(
      canonicalizeSnapshot(
        {
          ...capRes.value,
          revision: params.mergeState.theirsSnapshot.revision,
          ...(params.mergeState.theirsSnapshot.accessScope
            ? { accessScope: params.mergeState.theirsSnapshot.accessScope }
            : {}),
        },
        { preserveComputed: true }
      )
    );
  }

  private async applyIndexedResolution(params: {
    readonly baseId: string;
    readonly baseName: string;
    readonly resolvedSnapshot: IBaseVcsSnapshot;
    readonly mergeState: IVcsMergeState;
    readonly includeSnapshot?: boolean;
  }): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    const resolutionPatch = diffSnapshots(
      params.mergeState.workingSnapshot,
      params.resolvedSnapshot
    );

    return runWithEngineSession(this.localEngine, async (engine) => {
      if (!isEmptyPatch(resolutionPatch)) {
        const applyRes = await engine.applyPatch(params.baseId, resolutionPatch, {
          skipCaptureSnapshot: true,
        });
        if (applyRes.isErr()) return err(applyRes.error);
      }
      return this.finalizeResolvedEngineSnapshot(engine, params);
    });
  }

  private async loadOrSynthesizeMergeState(
    conflicts: readonly IVcsConflict[]
  ): Promise<
    Result<
      | { readonly kind: 'idle'; readonly workingSnapshot: IBaseVcsSnapshot }
      | { readonly kind: 'ready'; readonly mergeState: IVcsMergeState },
      DomainError
    >
  > {
    const mergeStateRes = await this.stateRepository.readMergeState();
    if (mergeStateRes.isErr()) return err(mergeStateRes.error);
    if (mergeStateRes.value) {
      return ok({ kind: 'ready', mergeState: mergeStateRes.value });
    }

    const loadedRes = await loadIndexedWorkspaceDiff(this.stateRepository, this.localEngine);
    if (loadedRes.isErr()) return err(loadedRes.error);
    if (conflicts.length === 0) {
      return ok({ kind: 'idle', workingSnapshot: loadedRes.value.workingSnapshot });
    }
    return ok({
      kind: 'ready',
      mergeState: {
        baseSnapshot: loadedRes.value.baseSnapshot,
        oursSnapshot: loadedRes.value.workingSnapshot,
        theirsSnapshot: loadedRes.value.baseSnapshot,
        workingSnapshot: loadedRes.value.workingSnapshot,
        conflicts,
      },
    });
  }

  private async applyCompletedResolution(params: {
    readonly baseId: string;
    readonly baseName: string;
    readonly resolvedSnapshot: IBaseVcsSnapshot;
    readonly mergeState: IVcsMergeState;
    readonly remainingCount: number;
    readonly includeSnapshot?: boolean;
  }): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    if (params.remainingCount > 0) {
      return ok(params.resolvedSnapshot);
    }
    if (this.localEngine.captureWorkingDelta) {
      return this.applyIndexedResolution(params);
    }
    return this.hydrateResolvedSnapshot(params.resolvedSnapshot, params.mergeState);
  }

  async execute(
    input: IResolveBaseVcsConflictsInput
  ): Promise<Result<IResolveBaseVcsConflictsOutput, DomainError>> {
    const configRes = await this.stateRepository.readConfig();
    if (configRes.isErr()) return err(configRes.error);
    if (!configRes.value) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.not_initialized',
          message: 'VCS workspace is not initialized in this directory',
        })
      );
    }
    const config = configRes.value;

    const conflictsRes = await this.stateRepository.readConflicts();
    if (conflictsRes.isErr()) return err(conflictsRes.error);

    const stateRes = await this.loadOrSynthesizeMergeState(conflictsRes.value);
    if (stateRes.isErr()) return err(stateRes.error);
    if (stateRes.value.kind === 'idle') {
      return ok({
        remainingConflicts: [],
        resolvedCount: 0,
        workingSnapshot: stateRes.value.workingSnapshot,
      });
    }

    const mergeState = stateRes.value.mergeState;
    const resolveRes = resolveConflicts({ mergeState, resolutions: input.resolutions });
    if (resolveRes.isErr()) return err(resolveRes.error);

    const { resolvedSnapshot, remainingConflicts } = resolveRes.value;
    const writeConflictsRes = await this.stateRepository.writeConflicts(remainingConflicts);
    if (writeConflictsRes.isErr()) return err(writeConflictsRes.error);

    const nextMergeState =
      remainingConflicts.length === 0
        ? null
        : { ...mergeState, workingSnapshot: resolvedSnapshot, conflicts: remainingConflicts };
    const writeMergeRes = await this.stateRepository.writeMergeState(nextMergeState);
    if (writeMergeRes.isErr()) return err(writeMergeRes.error);

    const finalRes = await this.applyCompletedResolution({
      baseId: config.baseId,
      baseName: config.baseName,
      resolvedSnapshot,
      mergeState,
      remainingCount: remainingConflicts.length,
      includeSnapshot: input.includeSnapshot,
    });
    if (finalRes.isErr()) return err(finalRes.error);

    return ok({
      remainingConflicts,
      resolvedCount: mergeState.conflicts.length - remainingConflicts.length,
      workingSnapshot: finalRes.value,
    });
  }
}
