import { Module } from '@nestjs/common';
import { TeableEventEmitterModule } from '../event-emitter/event-emitter.module';
import { CalculationModule } from '../features/calculation/calculation.module';
import { TableModule } from '../features/table/table.module';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';

@Module({
  imports: [TableModule, CalculationModule, TeableEventEmitterModule.register()],
  providers: [ShareDbService, SqliteDbAdapter, DerivateChangeService],
  exports: [ShareDbService],
})
export class ShareDbModule {}
