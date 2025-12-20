import type { Result } from 'neverthrow';

import type { IExecutionContext } from './ExecutionContext';

export interface ICommandBus {
  execute<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, string>>;
}
