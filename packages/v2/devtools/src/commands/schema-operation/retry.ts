import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { SchemaOperationControl } from '../../services/SchemaOperationControl';
import { connectionOption, optionToUndefined } from '../shared';

const operationIdOption = Options.text('operation-id').pipe(
  Options.withDescription('Schema operation row ID (sgo...)'),
  Options.optional
);

const idempotencyKeyOption = Options.text('idempotency-key').pipe(
  Options.withDescription('Schema operation idempotency key'),
  Options.optional
);

const resetAttemptsOption = Options.boolean('reset-attempts').pipe(
  Options.withDefault(true),
  Options.withDescription('Reset attempts to 0 before retrying')
);

const lastErrorOption = Options.text('last-error').pipe(
  Options.withDescription('Optional last_error text to store before retrying'),
  Options.optional
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly operationId: Option.Option<string>;
  readonly idempotencyKey: Option.Option<string>;
  readonly resetAttempts: boolean;
  readonly lastError: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const schemaOperationControl = yield* SchemaOperationControl;
    const output = yield* Output;
    const input = {
      connection: optionToUndefined(args.connection),
      operationId: optionToUndefined(args.operationId),
      idempotencyKey: optionToUndefined(args.idempotencyKey),
      resetAttempts: args.resetAttempts,
      lastError: optionToUndefined(args.lastError),
    };

    const result = yield* schemaOperationControl
      .retryOperation({
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        resetAttempts: input.resetAttempts,
        lastError: input.lastError,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('schema-operation.retry', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('schema-operation.retry', input, result);
  });

export const schemaOperationRetry = Command.make(
  'retry',
  {
    connection: connectionOption,
    operationId: operationIdOption,
    idempotencyKey: idempotencyKeyOption,
    resetAttempts: resetAttemptsOption,
    lastError: lastErrorOption,
  },
  handler
).pipe(Command.withDescription('Requeue one schema operation for the background runner'));
