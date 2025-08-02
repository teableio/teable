import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { FormulaFieldService } from './field-calculate/formula-field.service';
import { FieldService } from './field.service';

@Module({
  imports: [CalculationModule],
  providers: [FieldService, DbProvider, FormulaFieldService],
  exports: [FieldService],
})
export class FieldModule {}
