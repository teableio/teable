import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import multer from 'multer';
import { StorageModule } from '../attachments/plugins/storage.module';
import { UserInitService } from './user-init.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  imports: [
    MulterModule.register({
      storage: multer.diskStorage({}),
    }),
    StorageModule,
  ],
  providers: [UserService, UserInitService],
  exports: [UserService],
})
export class UserModule {}
