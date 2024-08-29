import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { CommentOpenApiController } from './comment-open-api.controller';
import { CommentOpenApiService } from './comment-open-api.service';

@Module({
  imports: [NotificationModule, RecordOpenApiModule],
  controllers: [CommentOpenApiController],
  providers: [CommentOpenApiService],
  exports: [CommentOpenApiService],
})
export class CommentOpenApiModule {}
