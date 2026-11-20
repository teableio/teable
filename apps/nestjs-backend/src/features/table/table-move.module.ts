import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { RawOpStagingModule } from '../../share-db/raw-op-staging.module';
import { TableMutationCacheModule } from './open-api/table-mutation-cache.module';
import { TableMoveService } from './table-move.service';

@Module({
  imports: [RawOpStagingModule, TableMutationCacheModule],
  providers: [DbProvider, TableMoveService],
  exports: [TableMoveService],
})
export class TableMoveModule {}
