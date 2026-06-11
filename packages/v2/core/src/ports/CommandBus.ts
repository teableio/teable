import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type IPublicCommand = {
  readonly __publicCommandBrand: 'public';
};

export type IInternalCommand = {
  readonly __internalCommandBrand: 'internal';
};

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
  execute<TCommand extends IPublicCommand, TResult>(
    context: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, DomainError>>;
}

export interface IInternalCommandBus {
  execute<TCommand extends IInternalCommand, TResult>(
    context: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, DomainError>>;
}
