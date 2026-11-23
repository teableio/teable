import { DateTimeFormatting, type DomainError, NumberFormatting, TimeZone } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  diffComputedImpact,
  diffSnapshots,
  isEmptyPatch,
  summarizePatch,
} from '../../domain/diffSnapshots';
import { vcsDomainError } from '../../domain/errors';
import { canonicalizeSnapshot, deepEqualVcs } from '../../domain/fieldClassification';
import { threeWayMerge } from '../../domain/threeWayMerge';
import type {
  IBaseVcsPatch,
  IBaseVcsPatchSummary,
  IBaseVcsSnapshot,
  IComputedImpactReport,
  IFieldVcsSnapshot,
  IVcsConflict,
  VcsRemoteMode,
} from '../../domain/types';
import {
  v2VcsClientTokens,
  type IVcsLocalEnginePort,
  type IVcsRemoteGateway,
  type IVcsStateRepository,
} from '../../ports';
import {
  type LoadedVcsWorkspace,
  loadIndexedWorkspaceDiff,
  loadRemoteAndLocalDiffState,
  loadVcsWorkspace,
} from './workspaceHelpers';

export interface IDiffBaseVcsInput {
  readonly offline?: boolean;
  readonly upstreamSnapshot?: IBaseVcsSnapshot;
}

export interface IDiffBaseVcsOutput {
  readonly target: 'remote' | 'base';
  readonly baseRevision: number;
  readonly remoteRevision?: number;
  readonly remoteMode: VcsRemoteMode;
  readonly patch: IBaseVcsPatch;
  readonly summary: IBaseVcsPatchSummary;
  readonly localPatch: IBaseVcsPatch;
  readonly localSummary: IBaseVcsPatchSummary;
  readonly remotePatch?: IBaseVcsPatch;
  readonly remoteSummary?: IBaseVcsPatchSummary;
  readonly conflicts: readonly IVcsConflict[];
  readonly hasChanges: boolean;
  readonly hasLocalChanges: boolean;
  readonly hasRemoteChanges?: boolean;
  readonly computedImpact: IComputedImpactReport;
}

// PGlite materializes omitted presentation defaults when hydrating a schema. Compare the
// same representation on both sides while keeping explicit upstream option edits intact.
function alignHydratedFieldDefaults(
  source: IFieldVcsSnapshot,
  baseline: IFieldVcsSnapshot | undefined
): IFieldVcsSnapshot {
  if (!baseline?.options || baseline.type !== source.type) return source;
  const isFormula = source.type === 'formula';
  if (!isFormula && source.type !== 'number') return source;
  const options = source.options;
  const baselineFormat = baseline.options.formatting;
  const useFormat =
    options?.formatting === undefined &&
    (deepEqualVcs(baselineFormat, NumberFormatting.default().toDto()) ||
      (isFormula && deepEqualVcs(baselineFormat, DateTimeFormatting.default().toDto())));
  const useZone =
    isFormula &&
    options?.timeZone === undefined &&
    baseline.options.timeZone === TimeZone.default().toString();
  if (!useFormat && !useZone) return source;
  return {
    ...source,
    options: {
      ...options,
      ...(useFormat ? { formatting: baselineFormat } : {}),
      ...(useZone ? { timeZone: baseline.options.timeZone } : {}),
    },
  };
}

function alignSourceSnapshot(
  source: IBaseVcsSnapshot,
  baseline: IBaseVcsSnapshot
): IBaseVcsSnapshot {
  const baselineTables = new Map(baseline.tables.map((table) => [table.id, table]));
  return {
    ...source,
    tables: source.tables.map((table) => {
      const before = baselineTables.get(table.id);
      if (!before) return table;
      const fields = new Map(before.fields.map((field) => [field.id, field]));
      return {
        ...table,
        fields: table.fields.map((field) =>
          alignHydratedFieldDefaults(field, fields.get(field.id))
        ),
      };
    }),
  };
}

@injectable()
export class DiffBaseVcsService {
  constructor(
    @inject(v2VcsClientTokens.remoteGateway)
    private readonly remoteGateway: IVcsRemoteGateway,
    @inject(v2VcsClientTokens.localEngine)
    private readonly localEngine: IVcsLocalEnginePort,
    @inject(v2VcsClientTokens.stateRepository)
    private readonly stateRepository: IVcsStateRepository
  ) {}

  async execute(input?: IDiffBaseVcsInput): Promise<Result<IDiffBaseVcsOutput, DomainError>> {
    if (input?.offline) {
      const loadedRes = await loadIndexedWorkspaceDiff(this.stateRepository, this.localEngine, {
        includeComputedSchemaFullTable: true,
      });
      if (loadedRes.isErr()) return err(loadedRes.error);

      const { config, baseSnapshot, workingSnapshot, conflicts: storedConflicts } = loadedRes.value;
      const localPatch = diffSnapshots(baseSnapshot, workingSnapshot, {
        accessScope: baseSnapshot.accessScope,
      });
      const localSummary = summarizePatch(localPatch);
      const hasLocalChanges = !isEmptyPatch(localPatch);
      const computedImpact = diffComputedImpact(baseSnapshot, workingSnapshot);

      return ok({
        target: 'base',
        baseRevision: baseSnapshot.revision,
        remoteMode: config.remoteMode,
        patch: localPatch,
        summary: localSummary,
        localPatch,
        localSummary,
        conflicts: storedConflicts,
        hasChanges: hasLocalChanges,
        hasLocalChanges,
        computedImpact,
      });
    }

    if (input?.upstreamSnapshot) {
      const loaded = await loadVcsWorkspace(this.stateRepository, this.localEngine);
      if (loaded.isErr()) return err(loaded.error);
      if (loaded.value.config.baseId !== input.upstreamSnapshot.baseId) {
        return err(
          vcsDomainError.validation({
            code: 'vcs.base_mismatch',
            message: 'Snapshot belongs to another working copy',
          })
        );
      }
      return this.compareUpstream(
        loaded.value,
        alignSourceSnapshot(
          canonicalizeSnapshot(input.upstreamSnapshot, { preserveComputed: true }),
          loaded.value.baseSnapshot
        )
      );
    }

    const remoteAndLocalRes = await loadRemoteAndLocalDiffState(
      this.remoteGateway,
      this.stateRepository,
      this.localEngine,
      { includeComputedSchemaFullTable: true }
    );
    if (remoteAndLocalRes.isErr()) return err(remoteAndLocalRes.error);

    return this.compareUpstream(
      remoteAndLocalRes.value.loaded,
      remoteAndLocalRes.value.theirsSnapshot
    );
  }

  private compareUpstream(
    { config, baseSnapshot, workingSnapshot }: LoadedVcsWorkspace,
    liveRemoteSnapshot: IBaseVcsSnapshot
  ): Result<IDiffBaseVcsOutput, DomainError> {
    const localPatch = diffSnapshots(baseSnapshot, workingSnapshot, {
      accessScope: baseSnapshot.accessScope,
    });
    const localSummary = summarizePatch(localPatch);
    const hasLocalChanges = !isEmptyPatch(localPatch);

    const effectiveScope = liveRemoteSnapshot.accessScope ?? baseSnapshot.accessScope;

    const patch = diffSnapshots(liveRemoteSnapshot, workingSnapshot, {
      accessScope: effectiveScope,
    });
    const summary = summarizePatch(patch);
    const hasChanges = !isEmptyPatch(patch);

    const remotePatch = diffSnapshots(baseSnapshot, liveRemoteSnapshot, {
      accessScope: effectiveScope,
    });
    const remoteSummary = summarizePatch(remotePatch);
    const hasRemoteChanges = !isEmptyPatch(remotePatch);

    const mergePreview = threeWayMerge({
      base: baseSnapshot,
      ours: workingSnapshot,
      theirs: liveRemoteSnapshot,
      options: { multiValueStrategy: config.multiValueStrategy ?? 'strict' },
    });

    const computedImpact = diffComputedImpact(liveRemoteSnapshot, workingSnapshot);

    return ok({
      target: 'remote',
      baseRevision: baseSnapshot.revision,
      remoteRevision: liveRemoteSnapshot.revision,
      remoteMode: config.remoteMode,
      patch,
      summary,
      localPatch,
      localSummary,
      remotePatch,
      remoteSummary,
      conflicts: mergePreview.conflicts,
      hasChanges,
      hasLocalChanges,
      hasRemoteChanges,
      computedImpact,
    });
  }
}
