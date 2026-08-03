import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { NotificationModule } from '../../notification/notification.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { ImportTableCsvQueueProcessor, TABLE_IMPORT_CSV_QUEUE } from './import-csv.processor';

@Module({
  providers: [ImportTableCsvQueueProcessor],
  imports: [
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_QUEUE),
    ShareDbModule,
    NotificationModule,
    RecordOpenApiModule,
    StorageModule,
    EventEmitterModule,
  ],
  exports: [ImportTableCsvQueueProcessor],
})
export class ImportCsvModule {}
