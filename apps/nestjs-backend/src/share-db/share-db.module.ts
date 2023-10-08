import { Module } from '@nestjs/common';
import { CalculationModule } from '../features/calculation/calculation.module';
import { TableModule } from '../features/table/table.module';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';

@Module({
  imports: [TableModule, CalculationModule],
  providers: [ShareDbService, SqliteDbAdapter, DerivateChangeService],
  exports: [ShareDbService],
})
export class ShareDbModule {}
