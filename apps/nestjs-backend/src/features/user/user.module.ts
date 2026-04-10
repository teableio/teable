import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import multer from 'multer';
import { StorageModule } from '../attachments/plugins/storage.module';
import { SettingModule } from '../setting/setting.module';
import { LastVisitModule } from './last-visit/last-visit.module';
import { TrackingModule } from './tracking/tracking.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  imports: [
    MulterModule.register({
      storage: multer.diskStorage({}),
    }),
    StorageModule,
    SettingModule,
    LastVisitModule,
    TrackingModule,
  ],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
