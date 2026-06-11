import { Injectable, Logger } from '@nestjs/common';
import type { IExecutionContext, IInternalCommandBus, ITracer } from '@teable/v2-core';
import { ActorId, PropagateUserRenameCommand, v2CoreTokens } from '@teable/v2-core';

import { V2ContainerService } from './v2-container.service';

export type IUserRenamePropagationRequest = {
  actorId: string;
  userId: string;
  name: string;
  requestId?: string;
};

/**
 * Backend bridge for dispatching the v2 internal user-rename command. The command owns both the
 * physical user-snapshot patch and downstream computed refresh, so the Nest listener does not
 * mutate record tables directly anymore.
 */
@Injectable()
export class V2UserRenamePropagationService {
  private readonly logger = new Logger(V2UserRenamePropagationService.name);

  constructor(private readonly v2ContainerService: V2ContainerService) {}

  async propagateUserRename(input: IUserRenamePropagationRequest): Promise<void> {
    const actorIdResult = ActorId.create(input.actorId);
    if (actorIdResult.isErr()) {
      this.logger.error(actorIdResult.error.message);
      return;
    }

    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<IInternalCommandBus>(v2CoreTokens.internalCommandBus);
    const tracer = container.resolve<ITracer>(v2CoreTokens.tracer);
    const context: IExecutionContext = {
      actorId: actorIdResult.value,
      tracer,
      requestId: input.requestId ?? `user-rename:${input.userId}:${Date.now()}`,
    };
    const commandResult = PropagateUserRenameCommand.create({
      userId: input.userId,
      name: input.name,
    });
    if (commandResult.isErr()) {
      this.logger.error(commandResult.error.message);
      return;
    }

    const executeResult = await commandBus.execute(context, commandResult.value);
    if (executeResult.isErr()) {
      this.logger.error(executeResult.error.message);
    }
  }
}
