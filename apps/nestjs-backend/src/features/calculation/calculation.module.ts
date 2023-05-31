import { Module } from '@nestjs/common';
import { ReferenceService } from './reference.service';

@Module({
  providers: [ReferenceService],
  exports: [ReferenceService],
})
export class CalculationModule {}
