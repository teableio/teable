import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { FieldCalculateModule } from '../field-calculate/field-calculate.module';
import { FieldOpenApiModule } from '../open-api/field-open-api.module';
import { FieldDuplicateService } from './field-duplicate.service';

@Module({
  imports: [FieldOpenApiModule, FieldCalculateModule],
  providers: [DbProvider, FieldDuplicateService],
  exports: [FieldDuplicateService],
})
export class FieldDuplicateModule {}
