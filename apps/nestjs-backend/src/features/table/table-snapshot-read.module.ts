import { Module } from '@nestjs/common';
import { TableSnapshotReadService } from './table-snapshot-read.service';

@Module({
  providers: [TableSnapshotReadService],
  exports: [TableSnapshotReadService],
})
export class TableSnapshotReadModule {}
