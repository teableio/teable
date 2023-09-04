import { Module } from '@nestjs/common';
import { FieldCalculationService } from './field-calculation.service';
import { LinkService } from './link.service';
import { ReferenceService } from './reference.service';

@Module({
  providers: [ReferenceService, LinkService, FieldCalculationService],
  exports: [ReferenceService, LinkService, FieldCalculationService],
})
export class CalculationModule {}
