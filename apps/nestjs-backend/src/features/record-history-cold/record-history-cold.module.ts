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
 * services only — no queue, no worker. One-off tools (the EE CLI runner)
 * import THIS module so a manual flush/compact never starts a BullMQ
 * consumer that could steal and run scheduled maintenance jobs meant for
 * the long-lived processes.
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
