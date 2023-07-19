import { Module } from '@nestjs/common';
import { FieldBatchCalculationService } from './field-batch-calculation.service';
import { LinkService } from './link.service';
import { ReferenceService } from './reference.service';

@Module({
  providers: [ReferenceService, LinkService, FieldBatchCalculationService],
  exports: [ReferenceService, LinkService, FieldBatchCalculationService],
})
export class CalculationModule {}
