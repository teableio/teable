import { ActorId, ImportDotTeaStructureCommand, v2CoreTokens } from '@teable/v2-core';
import type { ICommandBus, ImportDotTeaStructureResult } from '@teable/v2-core';
import { Lifecycle } from '@teable/v2-di';
import { DotTeaParser } from '@teable/v2-dottea';
import { Effect, Layer } from 'effect';

import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  DotTeaImporter,
  type DotTeaImportInput,
  type DotTeaImportResult,
} from '../services/DotTeaImporter';

export const DotTeaImporterLive = Layer.effect(
  DotTeaImporter,
  Effect.gen(function* () {
    const { container, baseId: defaultBaseId, isPglite } = yield* Database;

    if (!container.isRegistered(v2CoreTokens.dotTeaParser)) {
      container.register(v2CoreTokens.dotTeaParser, DotTeaParser, {
        lifecycle: Lifecycle.Singleton,
      });
    }

    return {
      importStructure: (input: DotTeaImportInput): Effect.Effect<DotTeaImportResult, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const resolvedBaseId = input.baseId ?? defaultBaseId;
            if (!resolvedBaseId) {
              const hint = isPglite
                ? 'Use the auto-created base or pass --base-id'
                : 'Provide --base-id for non-pglite connections';
              throw new Error(`Missing baseId. ${hint}`);
            }

            const commandResult =
              input.source.type === 'path'
                ? ImportDotTeaStructureCommand.createFromPath({
                    baseId: resolvedBaseId,
                    path: input.source.path,
                  })
                : ImportDotTeaStructureCommand.createFromStream({
                    baseId: resolvedBaseId,
                    dotTeaStream: input.source.stream,
                  });

            if (commandResult.isErr()) {
              throw commandResult.error;
            }

            const actorIdResult = ActorId.create('cli-dottea-importer');
            if (actorIdResult.isErr()) {
              throw actorIdResult.error;
            }

            const commandBus = container.resolve(v2CoreTokens.commandBus) as ICommandBus;
            const context = { actorId: actorIdResult.value };
            const result = await commandBus.execute<
              ImportDotTeaStructureCommand,
              ImportDotTeaStructureResult
            >(context, commandResult.value);

            if (result.isErr()) {
              throw result.error;
            }

            return {
              baseId: resolvedBaseId,
              tableCount: result.value.tables.length,
              tables: result.value.tables,
            } satisfies DotTeaImportResult;
          },
          catch: (error) => CliError.fromUnknown(error),
        }),
    };
  })
);
