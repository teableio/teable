import type { Result } from 'neverthrow';
import type { DomainError, IExecutionContext } from '@teable/v2-core';
import type { ExplainResult, ExplainOptions } from '../types';

/**
 * Interface for command analyzers.
 */
export interface ICommandAnalyzer<TCommand> {
  /**
   * Analyze a command and produce an explain result.
   *
   * @param context - Execution context
   * @param command - The command to analyze
   * @param options - Explain options
   * @param startTime - Start timestamp for timing
   */
  analyze(
    context: IExecutionContext,
    command: TCommand,
    options: ExplainOptions,
    startTime: number
  ): Promise<Result<ExplainResult, DomainError>>;
}
