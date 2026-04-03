import { inject, injectable } from '@teable/v2-di';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  DuplicateRecordsApplicationService,
  type DuplicateRecordsStreamEvent,
} from '../application/services/DuplicateRecordsApplicationService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { TraceSpan } from '../ports/TraceSpan';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DuplicateRecordsStreamCommand } from './DuplicateRecordsStreamCommand';

export type DuplicateRecordsStreamResult = AsyncIterable<DuplicateRecordsStreamEvent>;

@CommandHandler(DuplicateRecordsStreamCommand)
@injectable()
export class DuplicateRecordsStreamHandler
  implements ICommandHandler<DuplicateRecordsStreamCommand, DuplicateRecordsStreamResult>
{
  constructor(
    @inject(v2CoreTokens.duplicateRecordsApplicationService)
    private readonly duplicateRecordsApplicationService: DuplicateRecordsApplicationService
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: DuplicateRecordsStreamCommand
  ): Promise<Result<DuplicateRecordsStreamResult, DomainError>> {
    return ok(this.duplicateRecordsApplicationService.createStream(context, command));
  }
}
