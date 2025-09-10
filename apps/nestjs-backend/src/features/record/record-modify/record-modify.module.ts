import { Module } from '@nestjs/common';
import { AttachmentsStorageModule } from '../../attachments/attachments-storage.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { DataLoaderModule } from '../../data-loader/data-loader.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { ComputedModule } from '../computed/computed.module';
import { RecordModule } from '../record.module';
import { RecordCreateService } from './record-create.service';
import { RecordDeleteService } from './record-delete.service';
import { RecordDuplicateService } from './record-duplicate.service';
import { RecordModifyService } from './record-modify.service';
import { RecordModifySharedService } from './record-modify.shared.service';
import { RecordUpdateService } from './record-update.service';

@Module({
  imports: [
    RecordModule,
    CalculationModule,
    FieldCalculateModule,
    ViewOpenApiModule,
    ViewModule,
    AttachmentsStorageModule,
    CollaboratorModule,
    DataLoaderModule,
    ComputedModule,
  ],
  providers: [
    RecordModifyService,
    RecordModifySharedService,
    RecordCreateService,
    RecordUpdateService,
    RecordDeleteService,
    RecordDuplicateService,
  ],
  exports: [RecordModifyService, RecordModifySharedService],
})
export class RecordModifyModule {}
