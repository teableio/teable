import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { CanaryModule } from '../canary/canary.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { NotificationModule } from '../notification/notification.module';
import { RecordOpenApiV2Module } from '../record/open-api/record-open-api-v2.module';
import { RecordStorageModule } from '../record-storage/record-storage.module';
import { V2Module } from '../v2/v2.module';
import { CommentOpenApiV2Service } from './comment-open-api-v2.service';
import { CommentOpenApiController } from './comment-open-api.controller';
import { CommentOpenApiService } from './comment-open-api.service';

@Module({
  imports: [
    CanaryModule,
    CollaboratorModule,
    NotificationModule,
    RecordOpenApiV2Module,
    AttachmentsStorageModule,
    RecordStorageModule,
    ShareDbModule,
    V2Module,
  ],
  controllers: [CommentOpenApiController],
  providers: [CommentOpenApiService, CommentOpenApiV2Service],
  exports: [CommentOpenApiService, CommentOpenApiV2Service],
})
export class CommentOpenApiModule {}
