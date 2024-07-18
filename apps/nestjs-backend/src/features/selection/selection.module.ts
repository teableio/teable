import { Module } from '@nestjs/common';
import { AggregationModule } from '../aggregation/aggregation.module';
import { FieldCalculateModule } from '../field/field-calculate/field-calculate.module';
import { FieldModule } from '../field/field.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SelectionController } from './selection.controller';
import { SelectionService } from './selection.service';

@Module({
  imports: [
    RecordModule,
    FieldModule,
    AggregationModule,
    RecordOpenApiModule,
    FieldCalculateModule,
  ],
  controllers: [SelectionController],
  providers: [SelectionService],
  exports: [SelectionService],
})
export class SelectionModule {}
