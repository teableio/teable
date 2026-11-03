import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import {
  EXPORT_BASE_CLEANUP_QUEUE,
  ExportBaseCleanupProcessor,
} from './export-base-cleanup.processor';

// queue consumer: mounted by the app root only
@Module({
  imports: [EventJobModule.registerQueue(EXPORT_BASE_CLEANUP_QUEUE), StorageModule],
  providers: [ExportBaseCleanupProcessor],
})
export class ExportBaseCleanupModule {}
