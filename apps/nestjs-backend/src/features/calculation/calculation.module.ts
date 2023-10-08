import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { BatchService } from './batch.service';
import { FieldCalculationService } from './field-calculation.service';
import { LinkService } from './link.service';
import { ReferenceService } from './reference.service';

@Module({
  providers: [DbProvider, ReferenceService, LinkService, FieldCalculationService, BatchService],
  exports: [ReferenceService, LinkService, FieldCalculationService, BatchService],
})
export class CalculationModule {}
