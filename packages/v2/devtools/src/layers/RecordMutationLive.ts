import {
  v2CoreTokens,
  CreateRecordCommand,
  UpdateRecordCommand,
  DeleteRecordsCommand,
  ActorId,
  type ICommandBus,
} from '@teable/v2-core';
import { Effect, Layer } from 'effect';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  RecordMutation,
  type CreateRecordInput,
  type CreateRecordOutput,
  type UpdateRecordInput,
  type UpdateRecordOutput,
  type DeleteRecordsInput,
  type DeleteRecordsOutput,
} from '../services/RecordMutation';

const createContext = () => {
  const actorIdResult = ActorId.create('cli-record-mutation');
  if (actorIdResult.isErr()) {
    return Effect.fail(CliError.fromUnknown(actorIdResult.error));
  }
  return Effect.succeed({ actorId: actorIdResult.value });
};

export const RecordMutationLive = Layer.effect(
  RecordMutation,
  Effect.gen(function* () {
    const { container } = yield* Database;

    const commandBus = container.resolve(v2CoreTokens.commandBus) as ICommandBus;

    return {
      createRecord: (input: CreateRecordInput): Effect.Effect<CreateRecordOutput, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = CreateRecordCommand.create({
            tableId: input.tableId,
            fields: input.fields,
            typecast: input.typecast ?? false,
          });
          if (commandResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(commandResult.error));
          }

          const result = yield* Effect.tryPromise({
            try: async () => {
              const executeResult = await commandBus.execute<
                CreateRecordCommand,
                { record: { id: () => { toString: () => string }; fields: () => unknown } }
              >(context, commandResult.value);
              if (executeResult.isErr()) throw executeResult.error;
              return executeResult.value;
            },
            catch: (e) => CliError.fromUnknown(e),
          });

          // Convert record fields to plain object
          const fields: Record<string, unknown> = {};
          const recordFields = result.record.fields() as {
            entries: () => Array<{
              fieldId: { toString: () => string };
              value: { toValue: () => unknown };
            }>;
          };
          for (const entry of recordFields.entries()) {
            fields[entry.fieldId.toString()] = entry.value.toValue();
          }

          return {
            recordId: result.record.id().toString(),
            fields,
          };
        }),

      updateRecord: (input: UpdateRecordInput): Effect.Effect<UpdateRecordOutput, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = UpdateRecordCommand.create({
            tableId: input.tableId,
            recordId: input.recordId,
            fields: input.fields,
            typecast: input.typecast ?? false,
          });
          if (commandResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(commandResult.error));
          }

          const result = yield* Effect.tryPromise({
            try: async () => {
              const executeResult = await commandBus.execute<
                UpdateRecordCommand,
                { record: { id: () => { toString: () => string }; fields: () => unknown } }
              >(context, commandResult.value);
              if (executeResult.isErr()) throw executeResult.error;
              return executeResult.value;
            },
            catch: (e) => CliError.fromUnknown(e),
          });

          // Convert record fields to plain object
          const fields: Record<string, unknown> = {};
          const recordFields = result.record.fields() as {
            entries: () => Array<{
              fieldId: { toString: () => string };
              value: { toValue: () => unknown };
            }>;
          };
          for (const entry of recordFields.entries()) {
            fields[entry.fieldId.toString()] = entry.value.toValue();
          }

          return {
            recordId: result.record.id().toString(),
            fields,
          };
        }),

      deleteRecords: (input: DeleteRecordsInput): Effect.Effect<DeleteRecordsOutput, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = DeleteRecordsCommand.create({
            tableId: input.tableId,
            recordIds: [...input.recordIds],
          });
          if (commandResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(commandResult.error));
          }

          yield* Effect.tryPromise({
            try: async () => {
              const executeResult = await commandBus.execute<DeleteRecordsCommand, void>(
                context,
                commandResult.value
              );
              if (executeResult.isErr()) throw executeResult.error;
              return executeResult.value;
            },
            catch: (e) => CliError.fromUnknown(e),
          });

          return {
            deletedCount: input.recordIds.length,
            deletedRecordIds: input.recordIds,
          };
        }),
    };
  })
);
