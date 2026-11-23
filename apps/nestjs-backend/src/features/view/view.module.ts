import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { RawOpStagingModule } from '../../share-db/raw-op-staging.module';
import { ViewDataSafetyLimitService } from './view-data-safety-limit.service';
import { ViewService } from './view.service';

@Module({
  imports: [CalculationModule, RawOpStagingModule],
  providers: [ViewService, ViewDataSafetyLimitService, DbProvider],
  exports: [ViewService],
})
export class ViewModule {}
