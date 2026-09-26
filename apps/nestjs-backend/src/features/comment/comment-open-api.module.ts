import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { CanaryModule } from '../canary/canary.module';
import { NotificationModule } from '../notification/notification.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { TableQuerySearchVectorRuntimeService } from '../v2/table-query-search-vector-runtime.service';
import { V2Module } from '../v2/v2.module';
import { CommentOpenApiV2Service } from './comment-open-api-v2.service';
import { CommentOpenApiController } from './comment-open-api.controller';
import { CommentOpenApiService } from './comment-open-api.service';

@Module({
  imports: [
    CanaryModule,
    NotificationModule,
    RecordOpenApiModule,
    AttachmentsStorageModule,
    RecordModule,
    ShareDbModule,
    V2Module,
  ],
  controllers: [CommentOpenApiController],
  providers: [CommentOpenApiService, CommentOpenApiV2Service, TableQuerySearchVectorRuntimeService],
  exports: [CommentOpenApiService, CommentOpenApiV2Service],
})
export class CommentOpenApiModule {}
