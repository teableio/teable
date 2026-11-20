import { Module, forwardRef } from '@nestjs/common';
import { CanaryModule } from '../../canary/canary.module';
import { FieldModule } from '../../field/field.module';
import { FieldOpenApiV2Module } from '../../field/open-api/field-open-api-v2.module';
import { RecordOpenApiV2Module } from '../../record/open-api/record-open-api-v2.module';
import { RecordModule } from '../../record/record.module';
import { ExportMetricsModule } from '../metrics/export-metrics.module';
import { ExportOpenApiController } from './export-open-api.controller';
import { ExportOpenApiService } from './export-open-api.service';

@Module({
  imports: [
    RecordModule,
    FieldModule,
    ExportMetricsModule,
    CanaryModule,
    forwardRef(() => RecordOpenApiV2Module),
    forwardRef(() => FieldOpenApiV2Module),
  ],
  controllers: [ExportOpenApiController],
  providers: [ExportOpenApiService],
  exports: [ExportOpenApiService],
})
export class ExportOpenApiModule {}
