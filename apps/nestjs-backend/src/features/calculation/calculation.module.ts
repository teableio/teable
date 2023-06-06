import { Module } from '@nestjs/common';
import { LinkService } from './link.service';
import { ReferenceService } from './reference.service';

@Module({
  providers: [ReferenceService, LinkService],
  exports: [ReferenceService],
})
export class CalculationModule {}
