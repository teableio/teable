import { Module } from '@nestjs/common';
import { FieldModule } from '../../field/field.module';
import { RecordModule } from '../../record/record.module';
import { ExportController } from './export-open-api.controller';
import { ExportOpenApiService } from './export-open-api.service';

@Module({
  imports: [RecordModule, FieldModule],
  controllers: [ExportController],
  providers: [ExportOpenApiService],
  exports: [ExportOpenApiService],
})
export class ExportOpenApiModule {}
