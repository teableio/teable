import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

@Module({
  controllers: [SettingController, AdminController],
  exports: [SettingService],
  providers: [SettingService, AdminService],
})
export class SettingModule {}
