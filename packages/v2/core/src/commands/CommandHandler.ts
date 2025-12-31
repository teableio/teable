import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { TraceSpan, isTraceSpanWrapped } from '../ports/TraceSpan';

export interface ICommandHandler<TCommand, TResult> {
  handle(context: IExecutionContext, command: TCommand): Promise<Result<TResult, DomainError>>;
}

export type CommandType<TCommand> = {
  readonly prototype: TCommand;
  readonly name: string;
};
export type CommandHandlerClass<TCommand, TResult> = {
  readonly prototype: ICommandHandler<TCommand, TResult>;
};

const commandHandlerRegistry = new Map<
  CommandType<unknown>,
  CommandHandlerClass<unknown, unknown>
>();

export const CommandHandler =
  <TCommand>(command: CommandType<TCommand>) =>
  (target: CommandHandlerClass<TCommand, unknown>): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target.prototype, 'handle');
    if (
      descriptor &&
      typeof descriptor.value === 'function' &&
      !isTraceSpanWrapped(descriptor.value)
    ) {
      TraceSpan()(target.prototype, 'handle', descriptor);
      Object.defineProperty(target.prototype, 'handle', descriptor);
    }
    commandHandlerRegistry.set(command, target as CommandHandlerClass<unknown, unknown>);
  };

export const getCommandHandlerToken = (
  command: CommandType<unknown>
): CommandHandlerClass<unknown, unknown> | undefined => commandHandlerRegistry.get(command);
