import { Module } from '@nestjs/common';
import { RecordModule } from '../record/record.module';
import { RecordCommentCleanupService } from './record-comment-cleanup.service';

@Module({
  imports: [RecordModule],
  providers: [RecordCommentCleanupService],
  exports: [RecordCommentCleanupService],
})
export class RecordCommentCleanupModule {}
