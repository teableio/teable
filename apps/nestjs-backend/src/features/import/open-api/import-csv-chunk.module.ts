import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { conditionalQueueProcessorProviders } from '../../../utils/queue';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { NotificationModule } from '../../notification/notification.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { ImportTableCsvChunkJob, TABLE_IMPORT_CSV_CHUNK_QUEUE } from './import-csv-chunk.job';
import { ImportTableCsvChunkQueueProcessor } from './import-csv-chunk.processor';
import { ImportCsvModule } from './import-csv.module';

@Module({
  providers: [
    ...conditionalQueueProcessorProviders(ImportTableCsvChunkQueueProcessor),
    ImportTableCsvChunkJob,
  ],
  imports: [
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE),
    ShareDbModule,
    RecordOpenApiModule,
    NotificationModule,
    StorageModule,
    EventEmitterModule,
    ImportCsvModule,
  ],
  exports: [ImportTableCsvChunkJob],
})
export class ImportCsvChunkModule {}
