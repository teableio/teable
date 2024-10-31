import { Module } from '@nestjs/common';
import { AttachmentsCropModule } from '../attachments/attachments-crop.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

@Module({
  imports: [AttachmentsCropModule],
  controllers: [SettingController, AdminController],
  exports: [SettingService],
  providers: [SettingService, AdminService],
})
export class SettingModule {}
