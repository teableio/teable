import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

@Module({
  controllers: [SettingController],
  exports: [SettingService],
  providers: [SettingService, AdminGuard],
})
export class SettingModule {}
