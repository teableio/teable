import { inject, injectable } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import * as UserRenamePropagationServicePort from '../ports/UserRenamePropagationService';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { PropagateUserRenameCommand } from './PropagateUserRenameCommand';

@CommandHandler(PropagateUserRenameCommand)
@injectable()
export class PropagateUserRenameHandler
  implements ICommandHandler<PropagateUserRenameCommand, void>
{
  constructor(
    @inject(v2CoreTokens.userRenamePropagationService)
    private readonly userRenamePropagationService: UserRenamePropagationServicePort.IUserRenamePropagationService
  ) {}

  handle(
    context: ExecutionContextPort.IExecutionContext,
    command: PropagateUserRenameCommand
  ): Promise<Result<void, DomainError>> {
    return this.userRenamePropagationService.propagateUserRename(context, {
      userId: command.userId,
      name: command.name,
    });
  }
}
