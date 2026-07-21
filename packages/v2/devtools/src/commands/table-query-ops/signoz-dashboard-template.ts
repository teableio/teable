import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';

const handler = () =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    const result = yield* tableQueryOps.signozDashboardTemplate();

    yield* output.success('table-query-ops.signoz-dashboard-template', {}, result);
  });

export const tableQueryOpsSignozDashboardTemplate = Command.make(
  'signoz-dashboard-template',
  {},
  handler
).pipe(
  Command.withDescription(
    'Print SigNoz dashboard and alert templates for Table Query Ops search observability'
  )
);
