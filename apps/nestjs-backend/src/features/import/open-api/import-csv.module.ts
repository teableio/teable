import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { conditionalQueueProcessorProviders } from '../../../utils/queue';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { NotificationModule } from '../../notification/notification.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { ImportTableCsvJob, TABLE_IMPORT_CSV_QUEUE } from './import-csv.job';
import { ImportTableCsvQueueProcessor } from './import-csv.processor';

@Module({
  providers: [
    ...conditionalQueueProcessorProviders(ImportTableCsvQueueProcessor),
    ImportTableCsvJob,
  ],
  imports: [
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_QUEUE),
    ShareDbModule,
    NotificationModule,
    RecordOpenApiModule,
    StorageModule,
    EventEmitterModule,
  ],
  exports: [ImportTableCsvJob],
})
export class ImportCsvModule {}
