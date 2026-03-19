import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { ComputedTaskControl } from '../../services/ComputedTaskControl';
import { Output } from '../../services/Output';
import { connectionOption, optionToUndefined } from '../shared';

const taskIdOption = Options.text('task-id').pipe(
  Options.withDescription('Computed outbox task ID (cuo...)')
);

const workerIdOption = Options.text('worker-id').pipe(
  Options.withDefault('devtools-computed'),
  Options.withDescription('Worker ID used to take over and run the task')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly taskId: string;
  readonly workerId: string;
}) =>
  Effect.gen(function* () {
    const computedTaskControl = yield* ComputedTaskControl;
    const output = yield* Output;

    const input = {
      taskId: args.taskId,
      workerId: args.workerId,
      connection: optionToUndefined(args.connection),
    };

    const result = yield* computedTaskControl
      .runTaskById({
        taskId: args.taskId,
        workerId: args.workerId,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('computed.run-task', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('computed.run-task', input, result);
  });

export const computedRunTask = Command.make(
  'run-task',
  {
    connection: connectionOption,
    taskId: taskIdOption,
    workerId: workerIdOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Take over a pending/processing computed outbox task by ID and execute it immediately'
  )
);
