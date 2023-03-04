import { Module } from '@nestjs/common';
import { TableModule } from '../features/table/table.module';
import { PrismaService } from '../prisma.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { TransactionService } from './transaction.service';

@Module({
  imports: [TableModule],
  providers: [ShareDbService, SqliteDbAdapter, PrismaService, TransactionService],
  exports: [ShareDbService, TransactionService],
})
export class ShareDbModule {}
