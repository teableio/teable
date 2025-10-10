import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import multer from 'multer';
import { StorageModule } from '../../attachments/plugins/storage.module';
import { TurnstileModule } from '../../auth/turnstile/turnstile.module';
import { SettingModule } from '../setting.module';
import { SettingOpenApiController } from './setting-open-api.controller';
import { SettingOpenApiService } from './setting-open-api.service';

@Module({
  imports: [
    MulterModule.register({
      storage: multer.diskStorage({}),
    }),
    StorageModule,
    SettingModule,
    TurnstileModule,
  ],
  controllers: [SettingOpenApiController],
  exports: [SettingOpenApiService],
  providers: [SettingOpenApiService],
})
export class SettingOpenApiModule {}
