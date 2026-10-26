import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import {
  UpdateRecordApplicationService,
  type UpdateRecordResult,
} from './UpdateRecordApplicationService';
import { UpdateRecordCommand } from './UpdateRecordCommand';

export { UpdateRecordResult } from './UpdateRecordApplicationService';

@CommandHandler(UpdateRecordCommand)
@injectable()
export class UpdateRecordHandler implements ICommandHandler<
  UpdateRecordCommand,
  UpdateRecordResult
> {
  constructor(
    @inject(v2CoreTokens.updateRecordApplicationService)
    private readonly applicationService: UpdateRecordApplicationService
  ) {}

  handle(
    context: IExecutionContext,
    command: UpdateRecordCommand
  ): Promise<Result<UpdateRecordResult, DomainError>> {
    return this.applicationService.execute(context, command);
  }
}
