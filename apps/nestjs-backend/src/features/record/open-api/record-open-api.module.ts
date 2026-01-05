import { Module } from '@nestjs/common';
import { AttachmentsStorageModule } from '../../attachments/attachments-storage.module';
import { AttachmentsModule } from '../../attachments/attachments.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { TableDomainQueryModule } from '../../table-domain';
import { V2Module } from '../../v2/v2.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { RecordModifyModule } from '../record-modify/record-modify.module';
import { RecordModule } from '../record.module';
import { RecordOpenApiV2Service } from './record-open-api-v2.service';
import { RecordOpenApiController } from './record-open-api.controller';
import { RecordOpenApiService } from './record-open-api.service';

@Module({
  imports: [
    RecordModule,
    RecordModifyModule,
    FieldCalculateModule,
    CalculationModule,
    AttachmentsStorageModule,
    AttachmentsModule,
    CollaboratorModule,
    ViewModule,
    ViewOpenApiModule,
    TableDomainQueryModule,
    V2Module,
  ],
  controllers: [RecordOpenApiController],
  providers: [RecordOpenApiService, RecordOpenApiV2Service],
  exports: [RecordOpenApiService],
})
export class RecordOpenApiModule {}
