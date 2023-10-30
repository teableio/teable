import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { FieldCalculateModule } from '../field-calculate/field-calculate.module';
import { FieldModule } from '../field.module';
import { FieldOpenApiController } from './field-open-api.controller';
import { FieldOpenApiService } from './field-open-api.service';

@Module({
  imports: [
    FieldModule,
    ShareDbModule,
    CalculationModule,
    RecordOpenApiModule,
    FieldCalculateModule,
  ],
  controllers: [FieldOpenApiController],
  providers: [FieldOpenApiService],
  exports: [FieldOpenApiService],
})
export class FieldOpenApiModule {}
