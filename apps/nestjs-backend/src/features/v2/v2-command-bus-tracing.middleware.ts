import { FieldId, RecordId, TableId, TeableSpanAttributes } from '@teable/v2-core';
import type {
  CommandBusNext,
  ICommandBusMiddleware,
  IExecutionContext,
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
const commandId = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (value instanceof TableId || value instanceof RecordId || value instanceof FieldId) {
    return value.toString();
  }
  return undefined;
};

/**
 * Extract relevant IDs from command for tracing.
 * Safely extracts tableId, recordId, fieldId if present.
 */
const extractCommandIds = (
  command: unknown
): { tableId?: string; recordId?: string; fieldId?: string } => {
  if (!command || typeof command !== 'object') return {};

  const cmd = command as Record<string, unknown>;
  return {
    tableId: commandId(cmd.tableId),
    recordId: commandId(cmd.recordId),
    fieldId: commandId(cmd.fieldId),
  };
};

export class CommandBusTracingMiddleware implements ICommandBusMiddleware {
  private pending = 0;
  private idle?: { promise: Promise<void>; resolve: () => void };

  pendingCount(): number {
    return this.pending;
  }

  settled(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    if (!this.idle) {
      let resolve!: () => void;
      // The backend's ES2022 library does not declare Promise.withResolvers.
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      this.idle = { promise, resolve };
    }
    return this.idle.promise;
  }

  async handle<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand,
    next: CommandBusNext<TCommand, TResult>
  ) {
    this.pending += 1;
    try {
      return await this.execute(context, command, next);
    } finally {
      this.pending -= 1;
      if (this.pending === 0) {
        this.idle?.resolve();
        this.idle = undefined;
      }
    }
  }

  private async execute<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand,
    next: CommandBusNext<TCommand, TResult>
  ) {
    const tracer = context.tracer;
    if (!tracer) {
      return next(context, command);
    }

    const commandName =
      (command as { constructor?: { name?: string } }).constructor?.name ?? 'UnknownCommand';
    const ids = extractCommandIds(command);

    // Build span attributes with teable prefix
    const attributes: Record<string, string> = {
      [TeableSpanAttributes.VERSION]: 'v2',
      [TeableSpanAttributes.COMPONENT]: 'command',
      [TeableSpanAttributes.COMMAND]: commandName,
      [TeableSpanAttributes.OPERATION]: `command.${commandName}`,
    };

    // Add entity IDs if present
    if (ids.tableId) {
      attributes[TeableSpanAttributes.TABLE_ID] = ids.tableId;
    }
    if (ids.recordId) {
      attributes[TeableSpanAttributes.RECORD_ID] = ids.recordId;
    }
    if (ids.fieldId) {
      attributes[TeableSpanAttributes.FIELD_ID] = ids.fieldId;
    }

    const span = tracer.startSpan(`teable.command.${commandName}`, attributes);

    try {
      const result = await next(context, command);
      if (result.isErr()) {
        span.recordError(result.error.message ?? 'Unknown error');
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
