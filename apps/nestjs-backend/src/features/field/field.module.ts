import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldService } from './field.service';
import { FormulaExpansionService } from './formula-expansion.service';

@Module({
  imports: [CalculationModule],
  providers: [FieldService, DbProvider, FormulaExpansionService],
  exports: [FieldService],
})
export class FieldModule {}
