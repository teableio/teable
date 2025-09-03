import { Module } from '@nestjs/common';
import { AttachmentsStorageModule } from '../../attachments/attachments-storage.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { RecordModule } from '../record.module';
import { RecordModifyService } from './record-modify.service';

@Module({
  imports: [
    RecordModule,
    CalculationModule,
    FieldCalculateModule,
    ViewOpenApiModule,
    ViewModule,
    AttachmentsStorageModule,
    CollaboratorModule,
  ],
  providers: [RecordModifyService],
  exports: [RecordModifyService],
})
export class RecordModifyModule {}
