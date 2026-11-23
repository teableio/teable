import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentCellValueModule } from '../attachments/attachment-cell-value.module';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { CalculationModule } from '../calculation/calculation.module';
import { RawOpStagingModule } from '../../share-db/raw-op-staging.module';
import { TableIndexModule } from '../table-index/table-index.module';
import { RecordQueryBuilderModule } from './query-builder';
import { RecordPermissionService } from './record-permission.service';
import { RecordQueryService } from './record-query.service';
import { RecordService } from './record.service';
import { ShareViewScopeService } from './share-view-scope.service';
import { UserNameListener } from './user-name.listener.service';

@Module({
  imports: [
    CalculationModule,
    RawOpStagingModule,
    AttachmentsStorageModule,
    AttachmentCellValueModule,
    RecordQueryBuilderModule,
    TableIndexModule,
  ],
  providers: [
    UserNameListener,
    RecordService,
    RecordQueryService,
    DbProvider,
    RecordPermissionService,
    ShareViewScopeService,
  ],
  exports: [RecordService, RecordQueryService, RecordPermissionService, ShareViewScopeService],
})
export class RecordModule {}
