import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable-group/db-main-prisma';
import { TeableEventEmitterModule } from '../event-emitter/event-emitter.module';
import { CalculationModule } from '../features/calculation/calculation.module';
import { TableModule } from '../features/table/table.module';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { TransactionService } from './transaction.service';

@Module({
  imports: [PrismaModule, TableModule, CalculationModule, TeableEventEmitterModule.register()],
  providers: [ShareDbService, SqliteDbAdapter, TransactionService, DerivateChangeService],
  exports: [ShareDbService, TransactionService],
})
export class ShareDbModule {}
