import { Module } from '@nestjs/common';
import { FieldModule } from '../features/field/field.module';
import { RecordModule } from '../features/record/record.module';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { TransactionService } from './transaction.service';

@Module({
  imports: [FieldModule, RecordModule],
  providers: [ShareDbService, SqliteDbAdapter, TransactionService],
  exports: [ShareDbService, TransactionService],
})
export class ShareDbModule {}
