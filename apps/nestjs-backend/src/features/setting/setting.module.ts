import { Module } from '@nestjs/common';
import { SettingService } from './setting.service';

@Module({
  imports: [],
  exports: [SettingService],
  providers: [SettingService],
})
export class SettingModule {}
