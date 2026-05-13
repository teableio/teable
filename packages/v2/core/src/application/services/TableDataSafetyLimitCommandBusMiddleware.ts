import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { CommandBusNext, ICommandBusMiddleware } from '../../ports/CommandBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableDataSafetyLimitPlugin } from '../../ports/TableDataSafetyLimitPlugin';
import {
  ExecutionContextTableDataSafetyLimitPlugin,
  TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';

export class TableDataSafetyLimitCommandBusMiddleware implements ICommandBusMiddleware {
  private readonly plugins: ReadonlyArray<ITableDataSafetyLimitPlugin>;

  constructor(...plugins: ReadonlyArray<ITableDataSafetyLimitPlugin>) {
    this.plugins = [new ExecutionContextTableDataSafetyLimitPlugin(), ...plugins];
  }

  async handle<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand,
    next: CommandBusNext<TCommand, TResult>
  ): Promise<Result<TResult, DomainError>> {
    const composedResult = await TableDataSafetyLimitComposer.compose(this.plugins, context);
    if (composedResult.isErr()) return err(composedResult.error);

    return next(
      {
        ...context,
        config: {
          ...(context.config ?? {}),
          ...(composedResult.value ? { tableLimits: composedResult.value } : {}),
        },
      },
      command
    );
  }
}
