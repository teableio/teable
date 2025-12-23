import type {
  CommandBusNext,
  ICommandBusMiddleware,
  IExecutionContext,
  Result,
} from '@teable/v2-core' with { 'resolution-mode': 'import' };

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

export class CommandBusTracingMiddleware implements ICommandBusMiddleware {
  async handle<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand,
    next: CommandBusNext<TCommand, TResult>
  ): Promise<Result<TResult, string>> {
    const tracer = context.tracer;
    if (!tracer) {
      return next(context, command);
    }

    const commandName =
      (command as { constructor?: { name?: string } }).constructor?.name ?? 'UnknownCommand';
    const span = tracer.startSpan(`teable.command.${commandName}`, {
      command: commandName,
    });

    try {
      const result = await next(context, command);
      if (result.isErr()) {
        span.recordError(result.error);
      }
      return result;
    } catch (error) {
      span.recordError(describeError(error));
      throw error;
    } finally {
      span.end();
    }
  }
}
