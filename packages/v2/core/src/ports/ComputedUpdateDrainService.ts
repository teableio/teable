import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type ComputedUpdateDrainInput = {
  workerId: string;
  limit: number;
};

export interface IComputedUpdateDrainService {
  drainOnce(
    context: IExecutionContext,
    input: ComputedUpdateDrainInput
  ): Promise<Result<number, DomainError>>;
}
