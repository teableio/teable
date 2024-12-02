import { Module } from '@nestjs/common';
import { TableModule } from '../features/table/table.module';
import { ReadonlyModule } from './readonly/readonly.module';
import { RepairAttachmentOpModule } from './repair-attachment-op/repair-attachment-op.module';
import { ShareDbAdapter } from './share-db.adapter';
import { ShareDbService } from './share-db.service';

@Module({
  imports: [TableModule, ReadonlyModule, RepairAttachmentOpModule],
  providers: [ShareDbService, ShareDbAdapter],
  exports: [ShareDbService],
})
export class ShareDbModule {}
