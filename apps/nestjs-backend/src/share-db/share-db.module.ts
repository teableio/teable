import { Module } from '@nestjs/common';
import { SessionHandleModule } from '../features/auth/session/session-handle.module';
import { TableSnapshotReadModule } from '../features/table/table-snapshot-read.module';
import { RealtimeMetricsModule } from './metrics/realtime-metrics.module';
import { ReadonlyModule } from './readonly/readonly.module';
import { RepairAttachmentOpModule } from './repair-attachment-op/repair-attachment-op.module';
import { ShareDbAdapter } from './share-db.adapter';
import { ShareDbService } from './share-db.service';

@Module({
  imports: [
    TableSnapshotReadModule,
    ReadonlyModule,
    RepairAttachmentOpModule,
    RealtimeMetricsModule,
    SessionHandleModule,
  ],
  providers: [ShareDbService, ShareDbAdapter],
  exports: [ShareDbService, RealtimeMetricsModule],
})
export class ShareDbModule {}
