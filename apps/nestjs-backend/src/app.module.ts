import { BullModule } from '@nestjs/bullmq';
import type { ModuleMetadata } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { ICacheConfig } from './configs/cache.config';
import { ConfigModule } from './configs/config.module';
import { AccessTokenModule } from './features/access-token/access-token.module';
import { AggregationOpenApiModule } from './features/aggregation/open-api/aggregation-open-api.module';
import { AttachmentsModule } from './features/attachments/attachments.module';
import { AuthModule } from './features/auth/auth.module';
import { BaseModule } from './features/base/base.module';
import { ChatModule } from './features/chat/chat.module';
import { CollaboratorModule } from './features/collaborator/collaborator.module';
import { CommentOpenApiModule } from './features/comment/comment-open-api.module';
import { DashboardModule } from './features/dashboard/dashboard.module';
import { ExportOpenApiModule } from './features/export/open-api/export-open-api.module';
import { FieldOpenApiModule } from './features/field/open-api/field-open-api.module';
import { HealthModule } from './features/health/health.module';
import { ImportOpenApiModule } from './features/import/open-api/import-open-api.module';
import { InvitationModule } from './features/invitation/invitation.module';
import { NextModule } from './features/next/next.module';
import { NotificationModule } from './features/notification/notification.module';
import { OAuthModule } from './features/oauth/oauth.module';
import { PinModule } from './features/pin/pin.module';
import { PluginModule } from './features/plugin/plugin.module';
import { SelectionModule } from './features/selection/selection.module';
import { SettingModule } from './features/setting/setting.module';
import { ShareModule } from './features/share/share.module';
import { SpaceModule } from './features/space/space.module';
import { TrashModule } from './features/trash/trash.module';
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
    TrashModule,
    PluginModule,
    DashboardModule,
    CommentOpenApiModule,
  ],
  providers: [InitBootstrapProvider],
};

@Module({
  ...appModules,
  imports: [
    GlobalModule,
    ...appModules.imports,
    ConditionalModule.registerWhen(
      BullModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => {
          const redisUri = configService.get<ICacheConfig>('cache')?.redis.uri;
          if (!redisUri) {
            throw new Error('Redis URI is not defined');
          }
          const redis = new Redis(redisUri, { lazyConnect: true, maxRetriesPerRequest: null });
          await redis.connect();
          return {
            connection: redis,
          };
        },
        inject: [ConfigService],
      }),
      (env) => {
        return Boolean(env.BACKEND_CACHE_REDIS_URI);
      }
    ),
  ],
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
