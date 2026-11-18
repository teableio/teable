import { Module } from '@nestjs/common';
import { SourceImportTaskService } from './source-import-task.service';

@Module({
  providers: [SourceImportTaskService],
  exports: [SourceImportTaskService],
})
export class SourceImportTaskModule {}
