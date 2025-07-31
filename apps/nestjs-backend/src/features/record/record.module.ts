import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { CalculationModule } from '../calculation/calculation.module';
import { TableIndexService } from '../table/table-index.service';
import { RecordPermissionService } from './record-permission.service';
import { RecordQueryService } from './record-query.service';
import { RecordService } from './record.service';
import { UserNameListener } from './user-name.listener.service';

@Module({
  imports: [CalculationModule, AttachmentsStorageModule],
  providers: [
    UserNameListener,
    RecordService,
    RecordQueryService,
    DbProvider,
    TableIndexService,
    RecordPermissionService,
  ],
  exports: [RecordService, RecordQueryService],
})
export class RecordModule {}
