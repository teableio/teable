import type { MiddlewareConsumer } from '@nestjs/common';
import { Module, RequestMethod } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { CheckSettingsMiddleware } from './check-settings.middleware';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

@Module({
  controllers: [SettingController],
  exports: [SettingService],
  providers: [SettingService, AdminGuard],
})
export class SettingModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CheckSettingsMiddleware)
      .forRoutes(
        { path: '/api/auth/signup', method: RequestMethod.POST },
        { path: '/api/space', method: RequestMethod.POST }
      );
  }
}
