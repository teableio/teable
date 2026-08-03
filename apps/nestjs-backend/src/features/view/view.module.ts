import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { ViewDataSafetyLimitService } from './view-data-safety-limit.service';
import { ViewService } from './view.service';

@Module({
  imports: [CalculationModule],
  providers: [ViewService, ViewDataSafetyLimitService, DbProvider],
  exports: [ViewService],
})
export class ViewModule {}
