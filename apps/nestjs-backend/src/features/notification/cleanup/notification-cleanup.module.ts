import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import {
  NOTIFICATION_CLEANUP_QUEUE,
  NotificationCleanupProcessor,
} from './notification-cleanup.processor';

// queue consumer: mounted by the app root only
@Module({
  imports: [EventJobModule.registerQueue(NOTIFICATION_CLEANUP_QUEUE)],
  providers: [NotificationCleanupProcessor],
})
export class NotificationCleanupModule {}
