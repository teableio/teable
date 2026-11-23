import { Module } from '@nestjs/common';
import { DistributedLockModule } from '../../distributed-lock/distributed-lock.module';
import { AttachmentsTableModule } from '../attachments/attachments-table.module';
import { BaseModule } from '../base/base.module';
import { CanaryModule } from '../canary/canary.module';
import { RecordCommentCleanupModule } from '../comment/record-comment-cleanup.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { RecordRemovalColdCoreModule } from '../record-removal-cold/record-removal-cold.module';
import { ShortLinkModule } from '../short-link/short-link.module';
import { SpaceModule } from '../space/space.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { UserModule } from '../user/user.module';
import { TableLifecycleModule } from '../table-lifecycle/table-lifecycle.module';
import { ViewOpenApiV2Module } from '../view/open-api/view-open-api-v2.module';
import { V2Module } from '../v2/v2.module';
import { ViewModule } from '../view/view.module';
import { TableTrashListener } from './listener/table-trash.listener';
import { TRASH_RECORDED_HANDLERS, TrashListener } from './listener/trash.listener';
import { TRASH_RESOURCE_HANDLERS } from './resource/trash-resource-handler';
import { TrashResourceHandlerRegistry } from './resource/trash-resource-handler.registry';
import {
  COMMUNITY_TRASH_RECORDED_HANDLERS,
  COMMUNITY_TRASH_RESOURCE_HANDLERS,
} from './resource/trash-resource-handlers';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';
import { V2RecordTrashService } from './v2-record-trash.service';
import { V2TableTrashService } from './v2-table-trash.service';

@Module({
  imports: [
    AttachmentsTableModule,
    UserModule,
    SpaceModule,
    BaseModule,
    CanaryModule,
    DistributedLockModule,
    TableOpenApiModule,
    FieldOpenApiModule,
    RecordRemovalColdCoreModule,
    RecordCommentCleanupModule,
    RecordOpenApiModule,
    RecordModule,
    ShortLinkModule,
    V2Module,
    ViewModule,
    ViewOpenApiV2Module,
    TableLifecycleModule,
  ],
  controllers: [TrashController],
  providers: [
    TrashService,
    TableTrashListener,
    V2RecordTrashService,
    V2TableTrashService,
    ...COMMUNITY_TRASH_RESOURCE_HANDLERS,
    {
      provide: TRASH_RESOURCE_HANDLERS,
      useFactory: (...handlers: unknown[]) => handlers,
      inject: COMMUNITY_TRASH_RESOURCE_HANDLERS,
    },
    TrashListener,
    {
      provide: TRASH_RECORDED_HANDLERS,
      useFactory: (...handlers: unknown[]) => handlers,
      inject: COMMUNITY_TRASH_RECORDED_HANDLERS,
    },
    TrashResourceHandlerRegistry,
  ],
  exports: [TrashService],
})
export class TrashModule {}
