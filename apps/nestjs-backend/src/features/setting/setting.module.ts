import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

@Module({
  controllers: [SettingController, AdminController],
  exports: [SettingService],
  providers: [SettingService, AdminGuard, AdminService],
})
export class SettingModule {}
