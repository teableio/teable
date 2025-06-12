import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { NotificationModule } from '../../notification/notification.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import {
  ImportTableCsvChunkQueueProcessor,
  TABLE_IMPORT_CSV_CHUNK_QUEUE,
} from './import-csv-chunk.processor';
import { ImportTableCsvQueueProcessor, TABLE_IMPORT_CSV_QUEUE } from './import-csv.processor';

@Module({
  providers: [ImportTableCsvChunkQueueProcessor, ImportTableCsvQueueProcessor],
  imports: [
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE),
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_QUEUE),
    ShareDbModule,
    RecordOpenApiModule,
    NotificationModule,
    StorageModule,
    EventEmitterModule,
  ],
  exports: [ImportTableCsvChunkQueueProcessor, ImportTableCsvQueueProcessor],
})
export class ImportCsvChunkModule {}
