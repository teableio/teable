import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type CommandBusNext<TCommand, TResult> = (
  context: IExecutionContext,
  command: TCommand
) => Promise<Result<TResult, DomainError>>;

export interface ICommandBusMiddleware {
  handle<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand,
    next: CommandBusNext<TCommand, TResult>
  ): Promise<Result<TResult, DomainError>>;
}

export interface ICommandBus {
  execute<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, DomainError>>;
}
