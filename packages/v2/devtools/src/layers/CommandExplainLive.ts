import {
  registerCommandExplainModule,
  v2CommandExplainTokens,
  type IExplainService,
  type ExplainResult,
} from '@teable/v2-command-explain';
import {
  CreateRecordCommand,
  UpdateRecordCommand,
  DeleteRecordsCommand,
  PasteCommand,
  ActorId,
} from '@teable/v2-core';
import { registerV2DebugData } from '@teable/v2-debug-data';
import { Effect, Layer } from 'effect';
import { CliError } from '../errors/CliError';
import {
  CommandExplain,
  type ExplainCreateInput,
  type ExplainUpdateInput,
  type ExplainDeleteInput,
  type ExplainPasteInput,
} from '../services/CommandExplain';
import { Database } from '../services/Database';

const createContext = () => {
  const actorIdResult = ActorId.create('cli-debug');
  if (actorIdResult.isErr()) {
    return Effect.fail(CliError.fromUnknown(actorIdResult.error));
  }
  return Effect.succeed({ actorId: actorIdResult.value });
};

export const CommandExplainLive = Layer.effect(
  CommandExplain,
  Effect.gen(function* () {
    const { container } = yield* Database;

    registerV2DebugData(container);
    registerCommandExplainModule(container);

    const explainService = container.resolve(
      v2CommandExplainTokens.explainService
    ) as IExplainService;

    return {
      explainCreate: (input: ExplainCreateInput): Effect.Effect<ExplainResult, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = CreateRecordCommand.create({
            tableId: input.tableId,
            fields: input.fields,
          });
          if (commandResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(commandResult.error));
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const result = await explainService.explain(context, commandResult.value, {
                analyze: input.analyze,
                includeSql: true,
                includeGraph: false,
                includeLocks: true,
              });
              if (result.isErr()) throw result.error;
              return result.value;
            },
            catch: (e) => CliError.fromUnknown(e),
          });
        }),

      explainUpdate: (input: ExplainUpdateInput): Effect.Effect<ExplainResult, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = UpdateRecordCommand.create({
            tableId: input.tableId,
            recordId: input.recordId,
            fields: input.fields,
          });
          if (commandResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(commandResult.error));
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const result = await explainService.explain(context, commandResult.value, {
                analyze: input.analyze,
                includeSql: true,
                includeGraph: false,
                includeLocks: true,
              });
              if (result.isErr()) throw result.error;
              return result.value;
            },
            catch: (e) => CliError.fromUnknown(e),
          });
        }),

      explainDelete: (input: ExplainDeleteInput): Effect.Effect<ExplainResult, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = DeleteRecordsCommand.create({
            tableId: input.tableId,
            recordIds: input.recordIds,
          });
          if (commandResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(commandResult.error));
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const result = await explainService.explain(context, commandResult.value, {
                analyze: input.analyze,
                includeSql: true,
                includeGraph: false,
                includeLocks: true,
              });
              if (result.isErr()) throw result.error;
              return result.value;
            },
            catch: (e) => CliError.fromUnknown(e),
          });
        }),

      explainPaste: (input: ExplainPasteInput): Effect.Effect<ExplainResult, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = PasteCommand.create({
            tableId: input.tableId,
            viewId: input.viewId,
            ranges: input.ranges,
            content: input.content,
            type: input.type,
            filter: input.filter,
            updateFilter: input.updateFilter,
            sourceFields: input.sourceFields,
            typecast: input.typecast,
            projection: input.projection,
            sort: input.sort,
          });
          if (commandResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(commandResult.error));
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const result = await explainService.explain(context, commandResult.value, {
                analyze: input.analyze,
                includeSql: true,
                includeGraph: false,
                includeLocks: true,
              });
              if (result.isErr()) throw result.error;
              return result.value;
            },
            catch: (e) => CliError.fromUnknown(e),
          });
        }),
    };
  })
);
