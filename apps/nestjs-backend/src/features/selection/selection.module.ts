import { Module, forwardRef } from '@nestjs/common';
import { AggregationModule } from '../aggregation/aggregation.module';
import { CanaryModule } from '../canary/canary.module';
import { FieldCalculateModule } from '../field/field-calculate/field-calculate.module';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { SelectionController } from './selection.controller';
import { SelectionService } from './selection.service';

@Module({
  imports: [
    RecordModule,
    FieldModule,
    AggregationModule,
    forwardRef(() => RecordOpenApiModule),
    forwardRef(() => FieldOpenApiModule),
    FieldCalculateModule,
    CanaryModule,
  ],
  controllers: [SelectionController],
  providers: [SelectionService],
  exports: [SelectionService],
})
export class SelectionModule {}
