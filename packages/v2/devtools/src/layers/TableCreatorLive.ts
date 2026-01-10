import { ActorId, CreateTableCommand, v2CoreTokens } from '@teable/v2-core';
import type { CreateTableResult as CoreCreateTableResult, ICommandBus } from '@teable/v2-core';
import { Effect, Layer } from 'effect';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  TableCreator,
  type CreateTableInput,
  type CreateTableResult,
} from '../services/TableCreator';

export const TableCreatorLive = Layer.effect(
  TableCreator,
  Effect.gen(function* () {
    const { container } = yield* Database;

    return {
      createTable: (input: CreateTableInput): Effect.Effect<CreateTableResult, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const commandBus = container.resolve(v2CoreTokens.commandBus) as ICommandBus;

            // Build the command input (without records)
            const commandInput = {
              baseId: input.baseId,
              tableId: input.tableId,
              name: input.name,
              fields: input.fields ?? [],
              views: input.views ?? [],
              records: [], // explicitly no records
            };

            // Create and validate the command
            const commandResult = CreateTableCommand.create(commandInput);
            if (commandResult.isErr()) {
              throw commandResult.error;
            }

            // Execute via CommandBus
            const actorIdResult = ActorId.create('cli-table-creator');
            if (actorIdResult.isErr()) {
              throw actorIdResult.error;
            }
            const context = { actorId: actorIdResult.value };
            const result = await commandBus.execute<CreateTableCommand, CoreCreateTableResult>(
              context,
              commandResult.value
            );

            if (result.isErr()) {
              throw result.error;
            }

            const { table } = result.value;

            return {
              tableId: table.id().toString(),
              tableName: table.name().toString(),
              fieldCount: table.getFields().length,
              viewCount: table.views().length,
            };
          },
          catch: (e) => CliError.fromUnknown(e),
        }),
    };
  })
);
