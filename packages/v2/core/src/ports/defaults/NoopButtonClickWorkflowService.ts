import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type {
  ButtonClickWorkflowTarget,
  IButtonClickWorkflowService,
  PreparedButtonClickWorkflow,
} from '../ButtonClickWorkflowService';
import type { IExecutionContext } from '../ExecutionContext';

/**
 * Default when no automation host is registered. Exists only because ClickButton is a Table
 * command. Do not copy this Noop as a host-hook (folder, billing, sidebar).
 */
export class NoopButtonClickWorkflowService implements IButtonClickWorkflowService {
  async prepare(
    _context: IExecutionContext,
    _target: ButtonClickWorkflowTarget
  ): Promise<Result<PreparedButtonClickWorkflow, DomainError>> {
    return ok({ filter: null, run: async () => ok({ runId: '' }) });
  }
}
