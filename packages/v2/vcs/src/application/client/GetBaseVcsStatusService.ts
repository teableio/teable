import type { DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { diffSnapshots, isEmptyPatch, summarizePatch } from '../../domain/diffSnapshots';
import type {
  IBaseVcsPatchSummary,
  IBaseVcsSnapshot,
  IVcsConflict,
  IVcsWorkspaceConfig,
} from '../../domain/types';
import {
  v2VcsClientTokens,
  type IVcsLocalEnginePort,
  type IVcsRemoteGateway,
  type IVcsStateRepository,
} from '../../ports';
import {
  EAGER_RETURN_SNAPSHOT_RECORD_LIMIT,
  loadIndexedWorkspaceDiff,
  readRequiredBaseSnapshot,
} from './workspaceHelpers';

export interface IGetBaseVcsStatusInput {
  readonly checkRemote?: boolean;
  readonly includeSnapshot?: boolean;
}

export interface IGetBaseVcsStatusOutput {
  readonly config: IVcsWorkspaceConfig;
  readonly baseRevision: number;
  readonly remoteHeadRevision?: number;
  readonly summary: IBaseVcsPatchSummary;
  readonly hasChanges: boolean;
  readonly conflicts: readonly IVcsConflict[];
  readonly workingSnapshot: IBaseVcsSnapshot;
}

@injectable()
export class GetBaseVcsStatusService {
  constructor(
    @inject(v2VcsClientTokens.remoteGateway)
    private readonly remoteGateway: IVcsRemoteGateway,
    @inject(v2VcsClientTokens.localEngine)
    private readonly localEngine: IVcsLocalEnginePort,
    @inject(v2VcsClientTokens.stateRepository)
    private readonly stateRepository: IVcsStateRepository
  ) {}

  async execute(
    input?: IGetBaseVcsStatusInput
  ): Promise<Result<IGetBaseVcsStatusOutput, DomainError>> {
    const loadedRes = await loadIndexedWorkspaceDiff(this.stateRepository, this.localEngine);
    if (loadedRes.isErr()) return err(loadedRes.error);

    const { config, baseSnapshot, workingSnapshot, conflicts, isIndexed, totalBaseRecords } =
      loadedRes.value;
    const patch = diffSnapshots(baseSnapshot, workingSnapshot, {
      accessScope: baseSnapshot.accessScope,
    });
    const summary = summarizePatch(patch);
    const hasChanges = !isEmptyPatch(patch);

    let remoteHeadRevision: number | undefined;
    if (input?.checkRemote) {
      const headRes = await this.remoteGateway.getHead(config.baseId);
      if (headRes.isErr()) return err(headRes.error);
      remoteHeadRevision = headRes.value.headRevision;
    }

    let returnedWorkingSnapshot = workingSnapshot;
    const shouldCaptureFull =
      isIndexed &&
      (input?.includeSnapshot === true ||
        (input?.includeSnapshot !== false &&
          totalBaseRecords <= EAGER_RETURN_SNAPSHOT_RECORD_LIMIT));
    if (shouldCaptureFull) {
      const fullRes = config.readOnly
        ? await readRequiredBaseSnapshot(this.stateRepository)
        : await this.localEngine.captureSnapshot(config.baseId, {
            baseName: config.baseName,
            revision: baseSnapshot.revision,
          });
      if (fullRes.isErr()) return err(fullRes.error);
      returnedWorkingSnapshot = baseSnapshot.accessScope
        ? { ...fullRes.value, accessScope: baseSnapshot.accessScope }
        : fullRes.value;
    }

    return ok({
      config,
      baseRevision: baseSnapshot.revision,
      ...(remoteHeadRevision !== undefined ? { remoteHeadRevision } : {}),
      summary,
      hasChanges,
      conflicts,
      workingSnapshot: returnedWorkingSnapshot,
    });
  }
}
