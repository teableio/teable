import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AggregateModule } from '../features/aggregate/aggregate.module';
import { CalculationModule } from '../features/calculation/calculation.module';
import { TableModule } from '../features/table/table.module';
import { PrismaService } from '../prisma.service';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { TransactionService } from './transaction.service';

@Module({
  imports: [TableModule, CalculationModule, EventEmitterModule, AggregateModule],
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
