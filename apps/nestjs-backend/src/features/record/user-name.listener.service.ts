import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ModuleRef } from '@nestjs/core';
import { IUserInfoVo } from '@teable/openapi';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { V2UserRenamePropagationService } from '../v2/v2-user-rename-propagation.service';

@Injectable()
export class UserNameListener {
  private readonly logger = new Logger(UserNameListener.name);

  constructor(
    private readonly eventEmitterService: EventEmitterService,
    private readonly moduleRef: ModuleRef
  ) {}

  private async propagateRename(user: IUserInfoVo) {
    // Resolve lazily to avoid wiring RecordModule back to V2Module. V2Module already depends on
    // ShareDb/Table modules, which pull RecordModule in transitively.
    const propagationService = this.moduleRef.get(V2UserRenamePropagationService, {
      strict: false,
    });
    if (!propagationService) {
      this.logger.warn(
        'V2UserRenamePropagationService is unavailable, skipping user rename propagation'
      );
      return;
    }

    await propagationService.propagateUserRename({
      actorId: user.id,
      userId: user.id,
      requestId: `user-rename:${user.id}:${Date.now()}`,
      name: user.name,
    });
  }

  @OnEvent(Events.USER_RENAME, { async: true })
  async updateUserName(user: IUserInfoVo) {
    try {
      await this.propagateRename(user);
    } catch (e: unknown) {
      const error = e as Error;
      this.logger.error(error.message, error.stack);
    }

    this.eventEmitterService.emit(Events.TABLE_USER_RENAME_COMPLETE, user);
  }
}
