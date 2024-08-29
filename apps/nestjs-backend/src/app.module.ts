import type { ModuleMetadata } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AccessTokenModule } from './features/access-token/access-token.module';
import { AggregationOpenApiModule } from './features/aggregation/open-api/aggregation-open-api.module';
import { AttachmentsModule } from './features/attachments/attachments.module';
import { AuthModule } from './features/auth/auth.module';
import { BaseModule } from './features/base/base.module';
import { ChatModule } from './features/chat/chat.module';
import { CollaboratorModule } from './features/collaborator/collaborator.module';
import { ExportOpenApiModule } from './features/export/open-api/export-open-api.module';
import { FieldOpenApiModule } from './features/field/open-api/field-open-api.module';
import { HealthModule } from './features/health/health.module';
import { ImportOpenApiModule } from './features/import/open-api/import-open-api.module';
import { InvitationModule } from './features/invitation/invitation.module';
import { NextModule } from './features/next/next.module';
import { NotificationModule } from './features/notification/notification.module';
import { OAuthModule } from './features/oauth/oauth.module';
import { PinModule } from './features/pin/pin.module';
import { SelectionModule } from './features/selection/selection.module';
import { SettingModule } from './features/setting/setting.module';
import { ShareModule } from './features/share/share.module';
import { SpaceModule } from './features/space/space.module';
import { UndoRedoModule } from './features/undo-redo/open-api/undo-redo.module';
import { UserModule } from './features/user/user.module';
import { GlobalModule } from './global/global.module';
import { InitBootstrapProvider } from './global/init-bootstrap.provider';
import { LoggerModule } from './logger/logger.module';
import { WsModule } from './ws/ws.module';

export const appModules = {
  imports: [
    LoggerModule.register(),
    HealthModule,
    NextModule,
    FieldOpenApiModule,
    BaseModule,
    ChatModule,
    AttachmentsModule,
    WsModule,
    SelectionModule,
    UndoRedoModule,
    AggregationOpenApiModule,
    UserModule,
    AuthModule,
    SpaceModule,
    CollaboratorModule,
    InvitationModule,
    ShareModule,
    NotificationModule,
    AccessTokenModule,
    ImportOpenApiModule,
    ExportOpenApiModule,
    PinModule,
    SettingModule,
    OAuthModule,
  ],
  providers: [InitBootstrapProvider],
};

@Module({
  ...appModules,
  imports: [GlobalModule, ...appModules.imports],
  controllers: [],
})
export class AppModule {
  static register(customModuleMetadata: ModuleMetadata) {
    return {
      module: AppModule,
      ...customModuleMetadata,
    };
  }
}
