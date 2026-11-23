import { Module } from '@nestjs/common';
import { AttachmentCellValueModule } from '../../attachments/attachment-cell-value.module';
import { RecordHistoryColdCoreModule } from '../../record-history-cold/record-history-cold.module';
import { RecordStorageModule } from '../../record-storage/record-storage.module';
import { RecordHistoryReadService } from './record-history-read.service';

@Module({
  imports: [AttachmentCellValueModule, RecordHistoryColdCoreModule, RecordStorageModule],
  providers: [RecordHistoryReadService],
  exports: [RecordHistoryReadService],
})
export class RecordHistoryReadModule {}
