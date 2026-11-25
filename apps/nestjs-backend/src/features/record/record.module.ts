import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { RawOpStagingModule } from '../../share-db/raw-op-staging.module';
import { AttachmentCellValueModule } from '../attachments/attachment-cell-value.module';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { CalculationModule } from '../calculation/calculation.module';
import { RecordActorStorageModule } from '../record-attribution/record-actor-storage.module';
import { RecordMutationPolicyModule } from '../record-mutation-policy/record-mutation-policy.module';
import { TableIndexModule } from '../table-index/table-index.module';
import { RecordQueryBuilderModule } from './query-builder';
import { RecordPermissionService } from './record-permission.service';
import { RecordQueryService } from './record-query.service';
import { RecordService } from './record.service';
import { UserNameListener } from './user-name.listener.service';

@Module({
  imports: [
    CalculationModule,
    RawOpStagingModule,
    AttachmentsStorageModule,
    AttachmentCellValueModule,
    RecordQueryBuilderModule,
    TableIndexModule,
    RecordActorStorageModule,
    RecordMutationPolicyModule,
  ],
  providers: [
    UserNameListener,
    RecordService,
    RecordQueryService,
    DbProvider,
    RecordPermissionService,
  ],
  exports: [RecordService, RecordQueryService, RecordPermissionService],
  // Shared by the hosted raw/legacy writer entry points as well as RecordService.
})
export class RecordModule {}
