import { Module } from '@nestjs/common';
import { TeableEventEmitterModule } from '../event-emitter/event-emitter.module';
import { CalculationModule } from '../features/calculation/calculation.module';
import { TableModule } from '../features/table/table.module';
import { PrismaService } from '../prisma.service';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { TransactionService } from './transaction.service';

@Module({
  imports: [TableModule, CalculationModule, TeableEventEmitterModule.register()],
  providers: [
    ShareDbService,
    SqliteDbAdapter,
    PrismaService,
    TransactionService,
    DerivateChangeService,
  ],
  exports: [ShareDbService, TransactionService],
})
export class ShareDbModule {}
