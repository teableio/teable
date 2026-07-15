import { Module } from '@nestjs/common';
import { SpaceDataDbCopyService } from './space-data-db-copy.service';
import { SpaceDataDbProcessRunnerService } from './space-data-db-process-runner.service';

@Module({
  providers: [SpaceDataDbProcessRunnerService, SpaceDataDbCopyService],
  exports: [SpaceDataDbProcessRunnerService, SpaceDataDbCopyService],
})
export class SpaceDataDbCopyModule {}
