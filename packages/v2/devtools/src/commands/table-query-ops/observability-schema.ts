import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';

const handler = () =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    const result = yield* tableQueryOps.observabilitySchema();

    yield* output.success('table-query-ops.observability-schema', {}, result);
  });

export const tableQueryOpsObservabilitySchema = Command.make(
  'observability-schema',
  {},
  handler
).pipe(
  Command.withDescription(
    'Print Table Query Ops search tracing, metrics, and redaction attribute schema'
  )
);
