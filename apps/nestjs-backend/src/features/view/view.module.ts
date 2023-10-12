import { Module } from '@nestjs/common';
import { CalculationModule } from '../calculation/calculation.module';
import { ViewService } from './view.service';

@Module({
  imports: [CalculationModule],
  providers: [ViewService],
  exports: [ViewService],
})
export class ViewModule {}
