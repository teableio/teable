import { Module } from '@nestjs/common';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { RecordRemovalColdReadService } from './record-removal-cold-read.service';
import { RecordRemovalColdStorageService } from './record-removal-cold-storage.service';
import {
  RECORD_REMOVAL_COLD_QUEUE,
  RecordRemovalColdProcessor,
} from './record-removal-cold.processor';
import { RecordRemovalCompactorService } from './record-removal-compactor.service';
import { RecordRemovalFlusherService } from './record-removal-flusher.service';
import { RecordRemovalTombstoneService } from './record-removal-tombstone.service';

// services only — no queue, no worker. EVERY importer except the app root
// belongs here: feature modules (trash/archive readers), one-off tools (the
// EE CLI runner), and auxiliary worker entrypoints that compose feature
// modules. Importing the full module below instead silently turns the host
// process into a competing cold-queue consumer — on 2026-07-08 the BYODB
// migration worker picked up a record-history flush that way while still
// running old code mid-rolling-deploy, and broke the catch-up chain.
@Module({
  imports: [StorageModule],
  providers: [
    RecordRemovalColdStorageService,
    RecordRemovalColdReadService,
    RecordRemovalFlusherService,
    RecordRemovalCompactorService,
    RecordRemovalTombstoneService,
  ],
  exports: [
    RecordRemovalColdStorageService,
    RecordRemovalColdReadService,
    RecordRemovalFlusherService,
    RecordRemovalCompactorService,
    RecordRemovalTombstoneService,
  ],
})
export class RecordRemovalColdCoreModule {}

@Module({
  imports: [RecordRemovalColdCoreModule, EventJobModule.registerQueue(RECORD_REMOVAL_COLD_QUEUE)],
  providers: [RecordRemovalColdProcessor],
  exports: [RecordRemovalColdCoreModule],
})
export class RecordRemovalColdModule {}
