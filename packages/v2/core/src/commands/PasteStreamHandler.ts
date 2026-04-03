import { inject, injectable } from '@teable/v2-di';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { PasteStreamEvent, PasteStreamApplicationService } from './PasteHandler';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { TraceSpan } from '../ports/TraceSpan';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { PasteStreamCommand } from './PasteStreamCommand';

export type PasteStreamResult = AsyncIterable<PasteStreamEvent>;

@CommandHandler(PasteStreamCommand)
@injectable()
export class PasteStreamHandler implements ICommandHandler<PasteStreamCommand, PasteStreamResult> {
  constructor(
    @inject(v2CoreTokens.pasteStreamApplicationService)
    private readonly pasteStreamApplicationService: PasteStreamApplicationService
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: PasteStreamCommand
  ): Promise<Result<PasteStreamResult, DomainError>> {
    return ok(this.pasteStreamApplicationService.createStream(context, command));
  }
}
