import { Module } from '@nestjs/common';
import { V2Module } from '../../v2/v2.module';
import { TableMutationCacheInvalidator } from './table-mutation-cache-invalidator';
import { V2TableMutationCacheInvalidatorService } from './v2-table-mutation-cache-invalidator.service';

@Module({
  imports: [V2Module],
  providers: [
    V2TableMutationCacheInvalidatorService,
    {
      provide: TableMutationCacheInvalidator,
      useExisting: V2TableMutationCacheInvalidatorService,
    },
  ],
  exports: [TableMutationCacheInvalidator],
})
export class TableMutationCacheModule {}
