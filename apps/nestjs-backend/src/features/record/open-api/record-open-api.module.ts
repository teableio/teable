import { Module, forwardRef } from '@nestjs/common';
import { AggregationModule } from '../../aggregation/aggregation.module';
import { AttachmentsStorageModule } from '../../attachments/attachments-storage.module';
import { AttachmentsModule } from '../../attachments/attachments.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CanaryModule } from '../../canary/canary.module';
import { CollaboratorModule } from '../../collaborator/collaborator.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { FieldModule } from '../../field/field.module';
import { SelectionModule } from '../../selection/selection.module';
import { TableModule } from '../../table/table.module';
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
    FieldModule,
    CalculationModule,
    AggregationModule,
    AttachmentsStorageModule,
    AttachmentsModule,
    CollaboratorModule,
    ViewModule,
    ViewOpenApiModule,
    TableModule,
    TableDomainQueryModule,
    V2Module,
    CanaryModule,
    forwardRef(() => SelectionModule),
  ],
  controllers: [RecordOpenApiController],
  providers: [RecordOpenApiService, RecordOpenApiV2Service],
  exports: [RecordOpenApiService, RecordOpenApiV2Service],
})
export class RecordOpenApiModule {}
