import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { CalculationModule } from '../calculation/calculation.module';
import { TableIndexService } from '../table/table-index.service';
import { RecordQueryBuilderModule } from './query-builder';
import { RecordPermissionService } from './record-permission.service';
import { RecordQueryService } from './record-query.service';
import { RecordService } from './record.service';
import { ShareViewScopeService } from './share-view-scope.service';
import { UserNameListener } from './user-name.listener.service';

@Module({
  imports: [CalculationModule, AttachmentsStorageModule, RecordQueryBuilderModule],
  providers: [
    UserNameListener,
    RecordService,
    RecordQueryService,
    DbProvider,
    TableIndexService,
    RecordPermissionService,
    ShareViewScopeService,
  ],
  exports: [RecordService, RecordQueryService, RecordPermissionService, ShareViewScopeService],
})
export class RecordModule {}
