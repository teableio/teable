import type { Result } from 'neverthrow';

import type { IExecutionContext } from '../ports/ExecutionContext';

export interface ICommandHandler<TCommand, TResult> {
  handle(context: IExecutionContext, command: TCommand): Promise<Result<TResult, string>>;
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
    commandHandlerRegistry.set(command, target as CommandHandlerClass<unknown, unknown>);
  };

export const getCommandHandlerToken = (
  command: CommandType<unknown>
): CommandHandlerClass<unknown, unknown> | undefined => commandHandlerRegistry.get(command);
