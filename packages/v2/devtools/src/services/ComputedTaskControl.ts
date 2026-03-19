import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface RunComputedTaskByIdInput {
  readonly taskId: string;
  readonly workerId: string;
}

export interface RunComputedTaskByIdOutput {
  readonly taskId: string;
  readonly workerId: string;
  readonly processed: true;
}

export class ComputedTaskControl extends Context.Tag('ComputedTaskControl')<
  ComputedTaskControl,
  {
    readonly runTaskById: (
      input: RunComputedTaskByIdInput
    ) => Effect.Effect<RunComputedTaskByIdOutput, CliError>;
  }
>() {}
