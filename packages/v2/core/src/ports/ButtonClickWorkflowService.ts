import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { ButtonClicked } from '../domain/table/events/ButtonClicked';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { Table } from '../domain/table/Table';
import type { RecordFilter } from '../queries/RecordFilterDto';
import type { IExecutionContext } from './ExecutionContext';

export type ButtonClickWorkflowResult = Readonly<{
  runId: string;
}>;

export type ButtonClickWorkflowTarget = Readonly<{
  table: Table;
  fieldId: FieldId;
  workflowId: string;
}>;

export type PreparedButtonClickWorkflow = Readonly<{
  filter: RecordFilter;
  run(event: ButtonClicked): Promise<Result<ButtonClickWorkflowResult, DomainError>>;
}>;

/**
 * Application boundary for running the workflow selected by a Table-owned Button field.
 *
 * Allowed here because `ClickButton` is a Table command. Enterprise automation implements
 * this port and keeps the selected workflow snapshot private to the prepared execution.
 *
 * Not a template for host side-effects. Do not add a sibling Noop port for folder / base-node /
 * billing / sidebar — those are not Table concepts. Hosts attach after `commandBus.execute`.
 */
export interface IButtonClickWorkflowService {
  /**
   * Prepare the workflow once. The handler checks the filter before writing and runs the
   * same prepared workflow after commit.
   */
  prepare(
    context: IExecutionContext,
    target: ButtonClickWorkflowTarget
  ): Promise<Result<PreparedButtonClickWorkflow, DomainError>>;
}
