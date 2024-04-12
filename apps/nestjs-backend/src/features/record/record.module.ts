import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { CalculationModule } from '../calculation/calculation.module';
import { RecordPermissionService } from './record-permission.service';
import { RecordService } from './record.service';

@Module({
  imports: [CalculationModule, AttachmentsStorageModule],
  providers: [RecordService, DbProvider, RecordPermissionService],
  exports: [RecordService],
})
export class RecordModule {}
