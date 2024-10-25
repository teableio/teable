import { Module } from '@nestjs/common';
import { EventJobModule } from '../../../event-emitter/event-job/event-job.module';
import { AttachmentsStorageModule } from '../../attachments/attachments-storage.module';
import { AttachmentsModule } from '../../attachments/attachments.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { RecordCalculateModule } from '../record-calculate/record-calculate.module';
import { RECORD_IMAGE_QUEUE, RecordImageQueueProcessor } from '../record-image-queue.processor';
import { RecordModule } from '../record.module';
import { RecordOpenApiController } from './record-open-api.controller';
import { RecordOpenApiService } from './record-open-api.service';

@Module({
  imports: [
    RecordModule,
    RecordCalculateModule,
    FieldCalculateModule,
    CalculationModule,
    AttachmentsStorageModule,
    AttachmentsModule,
    CollaboratorModule,
    ViewModule,
    ViewOpenApiModule,
    EventJobModule.registerQueue(RECORD_IMAGE_QUEUE),
  ],
  controllers: [RecordOpenApiController],
  providers: [RecordOpenApiService, RecordImageQueueProcessor],
  exports: [RecordOpenApiService],
})
export class RecordOpenApiModule {}
