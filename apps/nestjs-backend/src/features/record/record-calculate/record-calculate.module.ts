import { Module } from '@nestjs/common';
import { CalculationModule } from '../../calculation/calculation.module';
import { FieldModule } from '../../field/field.module';
import { RecordModule } from '../record.module';
import { RecordCalculateService } from './record-calculate.service';

@Module({
  imports: [RecordModule, CalculationModule, FieldModule],
  providers: [RecordCalculateService],
  exports: [RecordCalculateService],
})
export class RecordCalculateModule {}
