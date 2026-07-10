import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { RecordHistoryColdReadService } from './record-history-cold-read.service';
import { RecordHistoryColdStorageService } from './record-history-cold-storage.service';
import {
  RECORD_HISTORY_COLD_QUEUE,
  RecordHistoryColdProcessor,
} from './record-history-cold.processor';
import { RecordHistoryCompactorService } from './record-history-compactor.service';
import { RecordHistoryFlusherService } from './record-history-flusher.service';

/**
 * services only — no queue, no worker. EVERY importer except the app root
 * belongs here: feature modules (record/table open-api), one-off tools (the
 * EE CLI runner), and auxiliary worker entrypoints that compose feature
 * modules. Importing the full module below instead silently turns the host
 * process into a competing cold-queue consumer — on 2026-07-08 the BYODB
 * migration worker picked up a flush that way while still running old code
 * mid-rolling-deploy, and broke the catch-up chain.
 */
@Module({
  imports: [StorageModule],
  providers: [
    RecordHistoryColdStorageService,
    RecordHistoryColdReadService,
    RecordHistoryFlusherService,
    RecordHistoryCompactorService,
  ],
  exports: [
    RecordHistoryColdStorageService,
    RecordHistoryColdReadService,
    RecordHistoryFlusherService,
    RecordHistoryCompactorService,
  ],
})
export class RecordHistoryColdCoreModule {}

@Module({
  imports: [RecordHistoryColdCoreModule, EventJobModule.registerQueue(RECORD_HISTORY_COLD_QUEUE)],
  providers: [RecordHistoryColdProcessor],
  exports: [RecordHistoryColdCoreModule],
})
export class RecordHistoryColdModule {}
