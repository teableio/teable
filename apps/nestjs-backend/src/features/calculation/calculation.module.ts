import { Module } from '@nestjs/common';
import { BatchService } from './batch.service';
import { FieldCalculationService } from './field-calculation.service';
import { LinkService } from './link.service';
import { ReferenceService } from './reference.service';

@Module({
  providers: [ReferenceService, LinkService, FieldCalculationService, BatchService],
  exports: [ReferenceService, LinkService, FieldCalculationService, BatchService],
})
export class CalculationModule {}
