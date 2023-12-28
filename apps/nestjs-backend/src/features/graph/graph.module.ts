import { Module } from '@nestjs/common';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldModule } from '../field/field.module';
import { RecordModule } from '../record/record.module';
import { GraphService } from './graph.service';

@Module({
  imports: [CalculationModule, RecordModule, FieldModule],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
