import type {
  ComputedUpdateDrainInput,
  DomainError,
  IComputedUpdateDrainService,
  IExecutionContext,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { ComputedUpdateWorker } from './worker/ComputedUpdateWorker';

@injectable()
export class ComputedUpdateDrainService implements IComputedUpdateDrainService {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateWorker)
    private readonly worker: ComputedUpdateWorker
  ) {}

  drainOnce(
    context: IExecutionContext,
    input: ComputedUpdateDrainInput
  ): Promise<Result<number, DomainError>> {
    return this.worker.runOnce({
      workerId: input.workerId,
      limit: input.limit,
      actorId: context.actorId,
      tracer: context.tracer,
      requestId: context.requestId,
    });
  }
}
