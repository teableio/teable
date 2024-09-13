import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { NotificationModule } from '../notification/notification.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { CommentOpenApiController } from './comment-open-api.controller';
import { CommentOpenApiService } from './comment-open-api.service';

@Module({
  imports: [
    NotificationModule,
    RecordOpenApiModule,
    AttachmentsStorageModule,
    RecordModule,
    ShareDbModule,
  ],
  controllers: [CommentOpenApiController],
  providers: [CommentOpenApiService],
  exports: [CommentOpenApiService],
})
export class CommentOpenApiModule {}
