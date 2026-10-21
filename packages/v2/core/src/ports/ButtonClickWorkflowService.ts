import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { ButtonClicked } from '../domain/table/events/ButtonClicked';
import type { IExecutionContext } from './ExecutionContext';

export type ButtonClickWorkflowResult = Readonly<{
  runId: string;
}>;

/**
 * Application boundary for running the workflow selected by a Table-owned Button field.
 *
 * Allowed here because `ClickButton` is a Table command: the aggregate already emitted
 * `ButtonClicked`. Enterprise automation implements this port; core never learns workflow ids.
 *
 * Not a template for host side-effects. Do not add a sibling Noop port for folder / base-node /
 * billing / sidebar — those are not Table concepts. Hosts attach after `commandBus.execute`.
 */
export interface IButtonClickWorkflowService {
  trigger(
    context: IExecutionContext,
    event: ButtonClicked
  ): Promise<Result<ButtonClickWorkflowResult, DomainError>>;
}
