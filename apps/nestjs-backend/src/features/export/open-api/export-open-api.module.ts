import { Module, forwardRef } from '@nestjs/common';
import { CanaryModule } from '../../canary/canary.module';
import { FieldModule } from '../../field/field.module';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
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
    forwardRef(() => RecordOpenApiModule),
    forwardRef(() => FieldOpenApiModule),
  ],
  controllers: [ExportOpenApiController],
  providers: [ExportOpenApiService],
  exports: [ExportOpenApiService],
})
export class ExportOpenApiModule {}
