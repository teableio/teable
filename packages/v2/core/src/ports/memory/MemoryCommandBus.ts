import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  getCommandHandlerToken,
  type CommandType,
  type CommandHandlerClass,
  type ICommandHandler,
} from '../../commands/CommandHandler';
import type { ICommandBus } from '../CommandBus';
import type { IExecutionContext } from '../ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../HandlerResolver';

export class MemoryCommandBus implements ICommandBus {
  constructor(private readonly handlerResolver: IHandlerResolver) {}

  async execute<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, string>> {
    const commandType = (command as { constructor: CommandType<TCommand> }).constructor;
    const handlerToken = getCommandHandlerToken(commandType as CommandType<unknown>) as
      | CommandHandlerClass<TCommand, TResult>
      | undefined;

    if (!handlerToken) {
      return err(`Missing command handler for ${commandType.name}`);
    }

    try {
      const handler = this.handlerResolver.resolve(
        handlerToken as IClassToken<ICommandHandler<TCommand, TResult>>
      );
      return await handler.handle(context, command);
    } catch (error) {
      if (error instanceof Error) {
        return err(error.message);
      }
      return err('Command handler execution failed');
    }
  }
}
