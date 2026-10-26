import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import {
  UpdateRecordsApplicationService,
  type UpdateRecordsResult,
} from './UpdateRecordsApplicationService';
import { UpdateRecordsCommand } from './UpdateRecordsCommand';

export { UpdateRecordsResult } from './UpdateRecordsApplicationService';

@CommandHandler(UpdateRecordsCommand)
@injectable()
export class UpdateRecordsHandler implements ICommandHandler<
  UpdateRecordsCommand,
  UpdateRecordsResult
> {
  constructor(
    @inject(v2CoreTokens.updateRecordsApplicationService)
    private readonly applicationService: UpdateRecordsApplicationService
  ) {}

  handle(
    context: IExecutionContext,
    command: UpdateRecordsCommand
  ): Promise<Result<UpdateRecordsResult, DomainError>> {
    return this.applicationService.execute(context, command);
  }
}
