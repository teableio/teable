import {
  computedUpdatePauseScopeTypes,
  type ComputedUpdatePauseScope,
  type ComputedUpdatePauseScopeType,
  type IComputedUpdatePauseRegistry,
  RunComputedTaskByIdCommand,
  type RunComputedTaskByIdResult,
  v2RecordRepositoryPostgresTokens,
} from '@teable/v2-adapter-table-repository-postgres';
import { ActorId, type IInternalCommandBus, v2CoreTokens } from '@teable/v2-core';
import { Effect, Layer } from 'effect';
import { CliError } from '../errors/CliError';
import {
  ComputedTaskControl,
  type ComputedPauseScopeRow,
  type ListComputedPauseScopesInput,
  type ListComputedPauseScopesOutput,
  type PauseComputedScopesInput,
  type PauseComputedScopesOutput,
  type ResumeComputedScopesInput,
  type ResumeComputedScopesOutput,
  type RunComputedTaskByIdInput,
  type RunComputedTaskByIdOutput,
} from '../services/ComputedTaskControl';
import { Database } from '../services/Database';

const createContext = () => {
  const actorIdResult = ActorId.create('cli-computed-task');
  if (actorIdResult.isErr()) {
    return Effect.fail(CliError.fromUnknown(actorIdResult.error));
  }
  return Effect.succeed({ actorId: actorIdResult.value });
};

const validateScopeType = (scopeType: string): scopeType is ComputedUpdatePauseScopeType =>
  computedUpdatePauseScopeTypes.includes(scopeType as ComputedUpdatePauseScopeType);

const toIso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

const toPauseScopeRow = (scope: ComputedUpdatePauseScope): ComputedPauseScopeRow => ({
  id: scope.id,
  scopeType: scope.scopeType,
  scopeId: scope.scopeId,
  scopeName: scope.scopeName,
  baseId: scope.baseId,
  baseName: scope.baseName,
  spaceId: scope.spaceId,
  spaceName: scope.spaceName,
  pausedAt: scope.pausedAt.toISOString(),
  pausedBy: scope.pausedBy,
  resumeAt: toIso(scope.resumeAt),
  reason: scope.reason,
  updatedAt: scope.updatedAt.toISOString(),
  updatedBy: scope.updatedBy,
  active: scope.active,
});

const blocksScope = (
  blocker: ComputedUpdatePauseScope,
  target: ComputedUpdatePauseScope
): boolean => {
  if (target.scopeType === 'table') {
    if (blocker.scopeType === 'space') return blocker.scopeId === target.spaceId;
    if (blocker.scopeType === 'base') return blocker.scopeId === target.baseId;
    return blocker.scopeId === target.scopeId;
  }
  if (target.scopeType === 'base') {
    if (blocker.scopeType === 'space') return blocker.scopeId === target.spaceId;
    return blocker.baseId === target.scopeId;
  }
  return blocker.spaceId === target.scopeId;
};

const parseResumeAt = (value: string | undefined): Date | null | undefined => {
  if (value == null) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CliError({
      message: `Invalid resumeAt: "${value}". Use ISO-8601 date/time text.`,
      code: 'INVALID_DATE',
      details: { field: 'resumeAt', value },
    });
  }
  return parsed;
};

export const ComputedTaskControlLive = Layer.effect(
  ComputedTaskControl,
  Effect.gen(function* () {
    const { container } = yield* Database;
    const internalCommandBus = container.resolve(
      v2CoreTokens.internalCommandBus
    ) as IInternalCommandBus;
    const pauseRegistry = container.resolve(
      v2RecordRepositoryPostgresTokens.computedUpdatePauseRegistry
    ) as IComputedUpdatePauseRegistry;

    return {
      runTaskById: (
        input: RunComputedTaskByIdInput
      ): Effect.Effect<RunComputedTaskByIdOutput, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();
          const commandResult = RunComputedTaskByIdCommand.create(input);
          if (commandResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(commandResult.error));
          }

          const result = yield* Effect.tryPromise({
            try: async () => {
              const executeResult = await internalCommandBus.execute<
                RunComputedTaskByIdCommand,
                RunComputedTaskByIdResult
              >(context, commandResult.value);
              if (executeResult.isErr()) throw executeResult.error;
              return executeResult.value;
            },
            catch: (error) => CliError.fromUnknown(error),
          });

          return result;
        }),
      pauseScope: (
        input: PauseComputedScopesInput
      ): Effect.Effect<PauseComputedScopesOutput, CliError> =>
        Effect.gen(function* () {
          if (!validateScopeType(input.scopeType)) {
            return yield* Effect.fail(
              new CliError({
                message: `Invalid scopeType: ${input.scopeType}`,
                code: 'INVALID_SCOPE_TYPE',
                details: { scopeType: input.scopeType, allowed: computedUpdatePauseScopeTypes },
              })
            );
          }

          const result = yield* Effect.tryPromise({
            try: async () => {
              const pauseResult = await pauseRegistry.pauseScope({
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                resumeAt: parseResumeAt(input.resumeAt),
                reason: input.reason,
                actor: input.actor ?? 'devtools-computed-pause',
              });
              if (pauseResult.isErr()) throw pauseResult.error;
              return pauseResult.value;
            },
            catch: (error) => CliError.fromUnknown(error),
          });

          return {
            scope: toPauseScopeRow(result),
            notes: [
              'Pause affects future computed task claims. In-flight tasks are not interrupted automatically.',
            ],
          };
        }),
      resumeScope: (
        input: ResumeComputedScopesInput
      ): Effect.Effect<ResumeComputedScopesOutput, CliError> =>
        Effect.gen(function* () {
          if ('scopeType' in input && !validateScopeType(input.scopeType)) {
            return yield* Effect.fail(
              new CliError({
                message: `Invalid scopeType: ${input.scopeType}`,
                code: 'INVALID_SCOPE_TYPE',
                details: { scopeType: input.scopeType, allowed: computedUpdatePauseScopeTypes },
              })
            );
          }

          const result = yield* Effect.tryPromise({
            try: async () => {
              const beforeResult = await pauseRegistry.listScopes({ activeOnly: false });
              if (beforeResult.isErr()) throw beforeResult.error;
              const target =
                'leaseId' in input
                  ? beforeResult.value.find((scope) => scope.id === input.leaseId)
                  : beforeResult.value.find(
                      (scope) =>
                        scope.scopeType === input.scopeType && scope.scopeId === input.scopeId
                    );
              const resumeResult =
                'leaseId' in input
                  ? await pauseRegistry.releaseLease({
                      leaseId: input.leaseId,
                      actor: input.actor ?? 'devtools-computed-resume',
                      releaseReason: input.releaseReason,
                    })
                  : await pauseRegistry.resumeScope({
                      scopeType: input.scopeType,
                      scopeId: input.scopeId,
                      actor: input.actor ?? 'devtools-computed-resume',
                      releaseReason: input.releaseReason,
                    });
              if (resumeResult.isErr()) throw resumeResult.error;
              const activeResult = await pauseRegistry.listScopes({ activeOnly: true });
              if (activeResult.isErr()) throw activeResult.error;
              const remainingBlockers = target
                ? activeResult.value.filter((scope) => blocksScope(scope, target))
                : [];
              return {
                resumed: resumeResult.value,
                target,
                remainingBlockers,
              };
            },
            catch: (error) => CliError.fromUnknown(error),
          });

          const leaseId = 'leaseId' in input ? input.leaseId : result.target?.id ?? null;
          const scopeType =
            result.target?.scopeType ?? ('scopeType' in input ? input.scopeType : null);
          const scopeId = result.target?.scopeId ?? ('scopeId' in input ? input.scopeId : null);
          return {
            leaseId,
            scopeType,
            scopeId,
            forced: 'scopeType' in input,
            resumed: result.resumed,
            remainingBlockers: result.remainingBlockers.map(toPauseScopeRow),
            notes: result.resumed
              ? result.remainingBlockers.length > 0
                ? [
                    `Pause lease released, but ${result.remainingBlockers.length} blocker(s) still affect the scope.`,
                  ]
                : ['Pause lease released. Workers can claim matching computed tasks again.']
              : ['No matching active pause lease existed.'],
          };
        }),
      listPauseScopes: (
        input: ListComputedPauseScopesInput
      ): Effect.Effect<ListComputedPauseScopesOutput, CliError> =>
        Effect.gen(function* () {
          const activeOnly = input.activeOnly ?? true;
          const scopes = yield* Effect.tryPromise({
            try: async () => {
              const listResult = await pauseRegistry.listScopes({ activeOnly });
              if (listResult.isErr()) throw listResult.error;
              return listResult.value;
            },
            catch: (error) => CliError.fromUnknown(error),
          });

          return {
            snapshotAt: new Date().toISOString(),
            activeOnly,
            scopes: scopes.map(toPauseScopeRow),
            notes: [
              'Paused scopes prevent workers and manual run-task execution from claiming matching computed tasks.',
            ],
          };
        }),
    };
  })
);
