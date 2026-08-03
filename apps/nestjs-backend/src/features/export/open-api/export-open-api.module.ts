import { Module } from '@nestjs/common';
import { FieldModule } from '../../field/field.module';
import { RecordModule } from '../../record/record.module';
import { ExportMetricsModule } from '../metrics/export-metrics.module';
import { ExportOpenApiController } from './export-open-api.controller';
import { ExportOpenApiService } from './export-open-api.service';

@Module({
  imports: [RecordModule, FieldModule, ExportMetricsModule],
  controllers: [ExportOpenApiController],
  providers: [ExportOpenApiService],
  exports: [ExportOpenApiService],
})
export class ExportOpenApiModule {}
