import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { CalculationModule } from '../calculation/calculation.module';
import { TableIndexService } from '../table/table-index.service';
import { RecordPermissionService } from './record-permission.service';
import { RecordService } from './record.service';
import { UserNameListener } from './user-name.listener.service';

@Module({
  imports: [CalculationModule, AttachmentsStorageModule],
  providers: [
    UserNameListener,
    RecordService,
    DbProvider,
    TableIndexService,
    RecordPermissionService,
  ],
  exports: [RecordService],
})
export class RecordModule {}
