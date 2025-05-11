import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { FieldOpenApiModule } from '../open-api/field-open-api.module';
import { FieldDuplicateService } from './field-duplicate.service';

@Module({
  imports: [FieldOpenApiModule],
  providers: [DbProvider, FieldDuplicateService],
  exports: [FieldDuplicateService],
})
export class FieldDuplicateModule {}
