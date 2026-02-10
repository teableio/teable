import { inject, injectable } from '@teable/v2-di';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  type DomainError,
  type IExecutionContext,
  domainError,
  UpdateRecordCommand,
  CreateRecordCommand,
  DeleteRecordsCommand,
  PasteCommand,
} from '@teable/v2-core';

import type { ExplainResult, ExplainOptions } from '../types';
import { DEFAULT_EXPLAIN_OPTIONS } from '../types';
import { v2CommandExplainTokens } from '../di/tokens';
import type { UpdateRecordAnalyzer } from '../analyzers/UpdateRecordAnalyzer';
import type { CreateRecordAnalyzer } from '../analyzers/CreateRecordAnalyzer';
import type { DeleteRecordsAnalyzer } from '../analyzers/DeleteRecordsAnalyzer';
import type { PasteCommandAnalyzer } from '../analyzers/PasteCommandAnalyzer';

/**
 * Interface for the explain service.
 */
export interface IExplainService {
  explain<TCommand>(
    context: IExecutionContext,
    command: TCommand,
    options?: ExplainOptions
  ): Promise<Result<ExplainResult, DomainError>>;
}

/**
 * Service for explaining command execution.
 * Analyzes commands and returns detailed information about their execution plan.
 */
@injectable()
export class ExplainService implements IExplainService {
  constructor(
    @inject(v2CommandExplainTokens.updateRecordAnalyzer)
    private readonly updateRecordAnalyzer: UpdateRecordAnalyzer,
    @inject(v2CommandExplainTokens.createRecordAnalyzer)
    private readonly createRecordAnalyzer: CreateRecordAnalyzer,
    @inject(v2CommandExplainTokens.deleteRecordsAnalyzer)
    private readonly deleteRecordsAnalyzer: DeleteRecordsAnalyzer,
    @inject(v2CommandExplainTokens.pasteCommandAnalyzer)
    private readonly pasteCommandAnalyzer: PasteCommandAnalyzer
  ) {}

  /**
   * Explain a command's execution plan.
   *
   * @param context - Execution context
   * @param command - The command to explain
   * @param options - Explain options
   * @returns Explain result with command info, computed impact, SQL explains, and complexity
   */
  async explain<TCommand>(
    context: IExecutionContext,
    command: TCommand,
    options: ExplainOptions = {}
  ): Promise<Result<ExplainResult, DomainError>> {
    const startTime = Date.now();
    const mergedOptions = { ...DEFAULT_EXPLAIN_OPTIONS, ...options };

    // Route to appropriate analyzer based on command type
    if (command instanceof UpdateRecordCommand) {
      return this.updateRecordAnalyzer.analyze(context, command, mergedOptions, startTime);
    }

    if (command instanceof CreateRecordCommand) {
      return this.createRecordAnalyzer.analyze(context, command, mergedOptions, startTime);
    }

    if (command instanceof DeleteRecordsCommand) {
      return this.deleteRecordsAnalyzer.analyze(context, command, mergedOptions, startTime);
    }

    if (command instanceof PasteCommand) {
      return this.pasteCommandAnalyzer.analyze(context, command, mergedOptions, startTime);
    }

    return err(
      domainError.validation({
        message: `Unsupported command type for explain: ${(command as object).constructor?.name ?? typeof command}`,
      })
    );
  }
}
