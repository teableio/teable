import { Module } from '@nestjs/common';
import { RecordStorageModule } from '../record-storage/record-storage.module';
import { RecordCommentCleanupService } from './record-comment-cleanup.service';

@Module({
  imports: [RecordStorageModule],
  providers: [RecordCommentCleanupService],
  exports: [RecordCommentCleanupService],
})
export class RecordCommentCleanupModule {}
