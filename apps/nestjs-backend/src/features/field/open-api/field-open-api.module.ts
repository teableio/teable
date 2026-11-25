import { Module, forwardRef } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CanaryModule } from '../../canary/canary.module';
import { FieldPeriodicRefreshModule } from '../../field-periodic-refresh/field-periodic-refresh.module';
import { FieldReferenceAdmissionModule } from '../../field-reference-admission/field-reference-admission.module';
import { GraphLegacyModule } from '../../graph/graph-legacy.module';
import { ComputedModule } from '../../record/computed/computed.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordQueryBuilderModule } from '../../record/query-builder';
import { RecordModule } from '../../record/record.module';
import { TableIndexModule } from '../../table-index/table-index.module';
import { V2Module } from '../../v2/v2.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { FieldCalculateModule } from '../field-calculate/field-calculate.module';
import { FieldModule } from '../field.module';
import { FieldOpenApiV2Module } from './field-open-api-v2.module';
import { FieldOpenApiController } from './field-open-api.controller';
import { FieldOpenApiService } from './field-open-api.service';

@Module({
  imports: [
    FieldModule,
    FieldPeriodicRefreshModule,
    RecordModule,
    ViewOpenApiModule,
    ShareDbModule,
    CalculationModule,
    forwardRef(() => RecordOpenApiModule),
    FieldCalculateModule,
    FieldReferenceAdmissionModule,
    ViewModule,
    GraphLegacyModule,
    RecordQueryBuilderModule,
    ComputedModule,
    V2Module,
    CanaryModule,
    FieldOpenApiV2Module,
    TableIndexModule,
  ],
  controllers: [FieldOpenApiController],
  providers: [DbProvider, FieldOpenApiService],
  exports: [
    FieldOpenApiService,
    FieldOpenApiV2Module,
    TableIndexModule,
    FieldPeriodicRefreshModule,
  ],
})
export class FieldOpenApiModule {}
