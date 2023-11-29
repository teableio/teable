import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldService } from './field.service';

@Module({
  imports: [CalculationModule, AttachmentsModule],
  providers: [FieldService],
  exports: [FieldService],
})
export class FieldModule {}
