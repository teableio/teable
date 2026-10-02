import { Injectable, Logger } from '@nestjs/common';
import type { DomainEventOutboxWorker } from '@teable/v2-adapter-table-repository-postgres';
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';

import { V2ContainerService } from '../v2-container.service';

@Injectable()
export class DomainEventWakeupHandler {
  private readonly logger = new Logger(DomainEventWakeupHandler.name);

  constructor(private readonly v2ContainerService: V2ContainerService) {}

  async handle(wakeup: { eventId: string; baseId: string }): Promise<void> {
    const container = await this.v2ContainerService.getContainerForBase(wakeup.baseId);
    const worker = container.resolve<DomainEventOutboxWorker>(
      v2RecordRepositoryPostgresTokens.domainEventOutboxWorker
    );
    const result = await worker.pollOnce();
    if (result.isErr()) {
      this.logger.warn('domain_event:wakeup_poll_failed', {
        eventId: wakeup.eventId,
        errorCode: result.error.code,
      });
      throw new Error(`domain_event wakeup poll failed: ${result.error.code}`);
    }
  }
}
