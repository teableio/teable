import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { CalculationModule } from '../calculation/calculation.module';
import { ViewService } from './view.service';

@Module({
  imports: [CalculationModule],
  providers: [ViewService, DbProvider],
  exports: [ViewService],
})
export class ViewModule {}
