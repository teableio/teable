import { Module } from '@nestjs/common';
import { PrismaService } from '../../src/prisma.service';
import { FieldModule } from '../features/field/field.module';
import { RecordModule } from '../features/record/record.module';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { TransactionService } from './transaction.service';

@Module({
  imports: [FieldModule, RecordModule],
  providers: [ShareDbService, SqliteDbAdapter, PrismaService, TransactionService],
  exports: [ShareDbService, TransactionService],
})
export class ShareDbModule {}
