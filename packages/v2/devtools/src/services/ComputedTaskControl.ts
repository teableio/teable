import type { ComputedUpdatePauseScopeType } from '@teable/v2-adapter-table-repository-postgres';
import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface RunComputedTaskByIdInput {
  readonly taskId: string;
  readonly workerId: string;
}

export interface RunComputedTaskByIdOutput {
  readonly taskId: string;
  readonly workerId: string;
  readonly processed: true;
}

export interface ComputedPauseScopeRow {
  readonly id: string;
  readonly scopeType: ComputedUpdatePauseScopeType;
  readonly scopeId: string;
  readonly scopeName: string | null;
  readonly baseId: string | null;
  readonly baseName: string | null;
  readonly spaceId: string | null;
  readonly spaceName: string | null;
  readonly pausedAt: string;
  readonly pausedBy: string | null;
  readonly resumeAt: string | null;
  readonly reason: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
  readonly active: boolean;
}

export interface PauseComputedScopesInput {
  readonly scopeType: ComputedUpdatePauseScopeType;
  readonly scopeId: string;
  readonly resumeAt?: string;
  readonly reason?: string;
  readonly actor?: string;
}

export interface PauseComputedScopesOutput {
  readonly scope: ComputedPauseScopeRow;
  readonly notes: ReadonlyArray<string>;
}

export interface ResumeComputedScopesInput {
  readonly scopeType: ComputedUpdatePauseScopeType;
  readonly scopeId: string;
}

export interface ResumeComputedScopesOutput {
  readonly scopeType: ComputedUpdatePauseScopeType;
  readonly scopeId: string;
  readonly resumed: boolean;
  readonly notes: ReadonlyArray<string>;
}

export interface ListComputedPauseScopesInput {
  readonly activeOnly?: boolean;
}

export interface ListComputedPauseScopesOutput {
  readonly snapshotAt: string;
  readonly activeOnly: boolean;
  readonly scopes: ReadonlyArray<ComputedPauseScopeRow>;
  readonly notes: ReadonlyArray<string>;
}

export class ComputedTaskControl extends Context.Tag('ComputedTaskControl')<
  ComputedTaskControl,
  {
    readonly runTaskById: (
      input: RunComputedTaskByIdInput
    ) => Effect.Effect<RunComputedTaskByIdOutput, CliError>;
    readonly pauseScope: (
      input: PauseComputedScopesInput
    ) => Effect.Effect<PauseComputedScopesOutput, CliError>;
    readonly resumeScope: (
      input: ResumeComputedScopesInput
    ) => Effect.Effect<ResumeComputedScopesOutput, CliError>;
    readonly listPauseScopes: (
      input: ListComputedPauseScopesInput
    ) => Effect.Effect<ListComputedPauseScopesOutput, CliError>;
  }
>() {}
