import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CalculationModule } from '../features/calculation/calculation.module';
import { TableModule } from '../features/table/table.module';
import { PrismaService } from '../prisma.service';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { TransactionService } from './transaction.service';

@Module({
  imports: [TableModule, CalculationModule, EventEmitterModule],
  providers: [
    ShareDbService,
    SqliteDbAdapter,
    PrismaService,
    TransactionService,
    DerivateChangeService,
  ],
  exports: [ShareDbService, TransactionService, EventEmitterModule.forRoot()],
})
export class ShareDbModule {}
