import { Injectable } from '@nestjs/common';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { invalidateUndoCaptureTableCache } from '@teable/v2-adapter-table-repository-postgres';
import { V2ContainerService } from '../../v2/v2-container.service';
import type { TableMutationCacheInvalidator } from './table-mutation-cache-invalidator';

@Injectable()
export class V2TableMutationCacheInvalidatorService implements TableMutationCacheInvalidator {
  constructor(private readonly v2ContainerService: V2ContainerService) {}

  async invalidateDroppedTable(dbTableName: string): Promise<void> {
    const container = await this.v2ContainerService.getContainer();
    const rootDb = container.resolve<object>(v2DataDbTokens.db);
    invalidateUndoCaptureTableCache(dbTableName, rootDb);
  }
}
