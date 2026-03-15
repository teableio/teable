import {
  registerCommandExplainModule,
  v2CommandExplainTokens,
  type IExplainService,
  type ExplainResult,
} from '@teable/v2-command-explain';
import {
  CreateRecordCommand,
  CreateFieldCommand,
  UpdateRecordCommand,
  UpdateFieldCommand,
  DeleteRecordsCommand,
  DeleteFieldCommand,
  DeleteTableCommand,
  PasteCommand,
  ActorId,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type ITableRepository,
} from '@teable/v2-core';
import { registerV2DebugData } from '@teable/v2-debug-data';
import { Effect, Layer } from 'effect';
import { CliError } from '../errors/CliError';
import {
  CommandExplain,
  type ExplainCreateFieldInput,
  type ExplainCreateInput,
  type ExplainDeleteFieldInput,
  type ExplainDeleteTableInput,
  type ExplainDeleteInput,
  type ExplainPasteInput,
  type ExplainUpdateFieldInput,
  type ExplainUpdateInput,
} from '../services/CommandExplain';
import { Database } from '../services/Database';

const createContextUnsafe = () => {
  const actorIdResult = ActorId.create('cli-debug');
  if (actorIdResult.isErr()) {
    throw CliError.fromUnknown(actorIdResult.error);
  }
  return { actorId: actorIdResult.value };
};

const createContext = () => Effect.sync(createContextUnsafe);

export const CommandExplainLive = Layer.effect(
  CommandExplain,
  Effect.gen(function* () {
    const { container } = yield* Database;

    registerV2DebugData(container);
    registerCommandExplainModule(container);

    const explainService = container.resolve(
      v2CommandExplainTokens.explainService
    ) as IExplainService;
    const tableRepository = container.resolve(v2CoreTokens.tableRepository) as ITableRepository;

    const resolveBaseId = (tableIdRaw: string): Effect.Effect<string, CliError> =>
      Effect.tryPromise({
        try: async () => {
          const tableId = TableId.create(tableIdRaw);
          if (tableId.isErr()) throw tableId.error;

          const context = createContextUnsafe();
          const table = await tableRepository.findOne(context, TableByIdSpec.create(tableId.value));
          if (table.isErr()) throw table.error;
          if (!table.value) throw new Error(`Table "${tableIdRaw}" not found`);
          return table.value.baseId().toString();
        },
        catch: (e) => CliError.fromUnknown(e),
      });

    return {
      explainCreateField: (
        input: ExplainCreateFieldInput
      ): Effect.Effect<ExplainResult, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = CreateFieldCommand.create({
            baseId: input.baseId,
            tableId: input.tableId,
            field: input.field,
            order: input.order,
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

      explainUpdateField: (
        input: ExplainUpdateFieldInput
      ): Effect.Effect<ExplainResult, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();

          const commandResult = UpdateFieldCommand.create({
            tableId: input.tableId,
            fieldId: input.fieldId,
            field: input.field,
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

      explainDeleteField: (
        input: ExplainDeleteFieldInput
      ): Effect.Effect<ExplainResult, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();
          const baseId = input.baseId ?? (yield* resolveBaseId(input.tableId));

          const commandResult = DeleteFieldCommand.create({
            baseId,
            tableId: input.tableId,
            fieldId: input.fieldId,
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

      explainDeleteTable: (
        input: ExplainDeleteTableInput
      ): Effect.Effect<ExplainResult, CliError> =>
        Effect.gen(function* () {
          const context = yield* createContext();
          const baseId = input.baseId ?? (yield* resolveBaseId(input.tableId));

          const commandResult = DeleteTableCommand.create({
            baseId,
            tableId: input.tableId,
            mode: input.mode,
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
