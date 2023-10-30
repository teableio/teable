import { Module } from '@nestjs/common';
import { AggregationOpenApiModule } from './features/aggregation/open-api/aggregation-open-api.module';
import { AttachmentsModule } from './features/attachments/attachments.module';
import { AuthModule } from './features/auth/auth.module';
import { AutomationModule } from './features/automation/automation.module';
import { BaseModule } from './features/base/base.module';
import { ChatModule } from './features/chat/chat.module';
import { CollaboratorModule } from './features/collaborator/collaborator.module';
import { FieldOpenApiModule } from './features/field/open-api/field-open-api.module';
import { FileTreeModule } from './features/file-tree/file-tree.module';
import { InvitationModule } from './features/invitation/invitation.module';
import { NextModule } from './features/next/next.module';
import { SelectionModule } from './features/selection/selection.module';
import { SpaceModule } from './features/space/space.module';
import { TableOpenApiModule } from './features/table/open-api/table-open-api.module';
import { UserModule } from './features/user/user.module';
import { GlobalModule } from './global/global.module';
import { TeableLoggerModule } from './logger/logger.module';
import { WsModule } from './ws/ws.module';

@Module({
  imports: [
    // DevtoolsModule.register({
    //   http: process.env.NODE_ENV !== 'production',
    // }),
    GlobalModule,
    TeableLoggerModule.register(),
    NextModule,
    FileTreeModule,
    TableOpenApiModule,
    FieldOpenApiModule,
    BaseModule,
    ChatModule,
    AttachmentsModule,
    AutomationModule,
    WsModule,
    SelectionModule,
    AggregationOpenApiModule,
    UserModule,
    AuthModule,
    SpaceModule,
    CollaboratorModule,
    InvitationModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
