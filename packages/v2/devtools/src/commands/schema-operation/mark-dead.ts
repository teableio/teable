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

const reasonOption = Options.text('reason').pipe(
  Options.withDescription('Reason to store in last_error'),
  Options.optional
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly operationId: Option.Option<string>;
  readonly idempotencyKey: Option.Option<string>;
  readonly reason: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const schemaOperationControl = yield* SchemaOperationControl;
    const output = yield* Output;
    const input = {
      connection: optionToUndefined(args.connection),
      operationId: optionToUndefined(args.operationId),
      idempotencyKey: optionToUndefined(args.idempotencyKey),
      reason: optionToUndefined(args.reason),
    };

    const result = yield* schemaOperationControl
      .markDeadOperation({
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('schema-operation.mark-dead', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('schema-operation.mark-dead', input, result);
  });

export const schemaOperationMarkDead = Command.make(
  'mark-dead',
  {
    connection: connectionOption,
    operationId: operationIdOption,
    idempotencyKey: idempotencyKeyOption,
    reason: reasonOption,
  },
  handler
).pipe(Command.withDescription('Mark one schema operation dead and clear any runner lock'));
