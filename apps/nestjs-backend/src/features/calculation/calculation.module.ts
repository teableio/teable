import { Module } from '@nestjs/common';
import { ComputeFieldService } from './compute-field.service';
import { LinkService } from './link.service';
import { ReferenceService } from './reference.service';

@Module({
  providers: [ReferenceService, LinkService, ComputeFieldService],
  exports: [ReferenceService, LinkService, ComputeFieldService],
})
export class CalculationModule {}
