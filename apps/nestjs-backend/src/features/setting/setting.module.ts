import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import multer from 'multer';
import { AttachmentsCropModule } from '../attachments/attachments-crop.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

@Module({
  imports: [
    AttachmentsCropModule,
    MulterModule.register({
      storage: multer.diskStorage({}),
    }),
    StorageModule,
  ],
  controllers: [SettingController, AdminController],
  exports: [SettingService],
  providers: [SettingService, AdminService],
})
export class SettingModule {}
