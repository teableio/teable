import { Module } from '@nestjs/common';
import { CalculationModule } from '../../calculation/calculation.module';
import { RecordCalculateModule } from '../../record/record-calculate/record-calculate.module';
import { FieldModule } from '../field.module';
import { FieldConvertingLinkService } from './field-converting-link.service';
import { FieldConvertingService } from './field-converting.service';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';
import { FieldSupplementService } from './field-supplement.service';

@Module({
  imports: [FieldModule, CalculationModule, RecordCalculateModule],
  providers: [
    FieldConvertingLinkService,
    FieldConvertingService,
    FieldCreatingService,
    FieldDeletingService,
    FieldSupplementService,
  ],
  exports: [
    FieldConvertingLinkService,
    FieldConvertingService,
    FieldCreatingService,
    FieldDeletingService,
    FieldSupplementService,
  ],
})
export class FieldCalculateModule {}
