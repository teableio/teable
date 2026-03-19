import { ActorId, type IInternalCommandBus, v2CoreTokens } from '@teable/v2-core';
import {
  RunComputedTaskByIdCommand,
  type RunComputedTaskByIdResult,
} from '@teable/v2-adapter-table-repository-postgres';
import { Effect, Layer } from 'effect';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  ComputedTaskControl,
  type RunComputedTaskByIdInput,
  type RunComputedTaskByIdOutput,
} from '../services/ComputedTaskControl';

const createContext = () => {
  const actorIdResult = ActorId.create('cli-computed-task');
  if (actorIdResult.isErr()) {
    return Effect.fail(CliError.fromUnknown(actorIdResult.error));
  }
  return Effect.succeed({ actorId: actorIdResult.value });
};

export const ComputedTaskControlLive = Layer.effect(
  ComputedTaskControl,
  Effect.gen(function* () {
    const { container } = yield* Database;
    const internalCommandBus = container.resolve(
      v2CoreTokens.internalCommandBus
    ) as IInternalCommandBus;

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
    };
  })
);
