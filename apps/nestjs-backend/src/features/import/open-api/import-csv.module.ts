import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { CanaryModule } from '../../canary/canary.module';
import { NotificationModule } from '../../notification/notification.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordMutationPolicyModule } from '../../record-mutation-policy/record-mutation-policy.module';
import { V2Module } from '../../v2/v2.module';
import { ImportTableCsvQueueProcessor, TABLE_IMPORT_CSV_QUEUE } from './import-csv.processor';

@Module({
  providers: [ImportTableCsvQueueProcessor],
  imports: [
    EventJobModule.registerQueue(TABLE_IMPORT_CSV_QUEUE),
    ShareDbModule,
    CanaryModule,
    NotificationModule,
    RecordOpenApiModule,
    V2Module,
    StorageModule,
    EventEmitterModule,
    RecordMutationPolicyModule,
  ],
  exports: [ImportTableCsvQueueProcessor],
})
export class ImportCsvModule {}
