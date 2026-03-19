import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { ComputedUpdateWorker } from './worker/ComputedUpdateWorker';
import { CommandHandler, type ICommandHandler } from '@teable/v2-core';
import {
  RunComputedTaskByIdCommand,
  type RunComputedTaskByIdResult,
} from './RunComputedTaskByIdCommand';

@CommandHandler(RunComputedTaskByIdCommand)
@injectable()
export class RunComputedTaskByIdHandler
  implements ICommandHandler<RunComputedTaskByIdCommand, RunComputedTaskByIdResult>
{
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateWorker)
    private readonly worker: ComputedUpdateWorker
  ) {}

  async handle(
    context: IExecutionContext,
    command: RunComputedTaskByIdCommand
  ): Promise<Result<RunComputedTaskByIdResult, DomainError>> {
    const result = await this.worker.runTaskById({
      taskId: command.taskId,
      workerId: command.workerId,
      actorId: context.actorId,
      tracer: context.tracer,
      requestId: context.requestId,
      allowProcessingTakeover: command.allowProcessingTakeover,
    });
    if (result.isErr()) return err(result.error);

    if (!result.value) {
      return err(
        domainError.notFound({
          code: 'computed_task.not_retryable',
          message: `Computed task not found or not retryable: ${command.taskId}`,
        })
      );
    }

    return ok({
      taskId: command.taskId,
      workerId: command.workerId,
      processed: true,
    });
  }
}
