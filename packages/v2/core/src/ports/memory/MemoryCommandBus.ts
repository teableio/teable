import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  getCommandHandlerToken,
  type CommandType,
  type CommandHandlerClass,
  type ICommandHandler,
} from '../../commands/CommandHandler';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { CommandBusNext, ICommandBus, ICommandBusMiddleware } from '../CommandBus';
import type { IExecutionContext } from '../ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../HandlerResolver';

export class MemoryCommandBus implements ICommandBus {
  constructor(
    private readonly handlerResolver: IHandlerResolver,
    private readonly middlewares: ReadonlyArray<ICommandBusMiddleware> = []
  ) {}

  async execute<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, DomainError>> {
    const executeHandler = async (
      handlerContext: IExecutionContext,
      handlerCommand: TCommand
    ): Promise<Result<TResult, DomainError>> => {
      const commandType = (handlerCommand as { constructor: CommandType<TCommand> }).constructor;
      const handlerToken = getCommandHandlerToken(commandType as CommandType<unknown>) as
        | CommandHandlerClass<TCommand, TResult>
        | undefined;

      if (!handlerToken) {
        return err(
          domainError.validation({ message: `Missing command handler for ${commandType.name}` })
        );
      }

      try {
        const handler = this.handlerResolver.resolve(
          handlerToken as IClassToken<ICommandHandler<TCommand, TResult>>
        );
        return await handler.handle(handlerContext, handlerCommand);
      } catch (error) {
        if (error instanceof Error) {
          return err(domainError.fromUnknown(error));
        }
        return err(domainError.unexpected({ message: 'Command handler execution failed' }));
      }
    };

    const pipeline = this.middlewares.reduceRight<CommandBusNext<TCommand, TResult>>(
      (next, middleware) => async (middlewareContext, middlewareCommand) => {
        try {
          return await middleware.handle(middlewareContext, middlewareCommand, next);
        } catch (error) {
          if (error instanceof Error) {
            return err(domainError.fromUnknown(error));
          }
          return err(domainError.unexpected({ message: 'Command middleware execution failed' }));
        }
      },
      executeHandler as CommandBusNext<TCommand, TResult>
    );

    return pipeline(context, command);
  }
}
