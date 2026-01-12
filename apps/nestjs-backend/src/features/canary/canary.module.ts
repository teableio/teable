import { Module } from '@nestjs/common';
import { SettingModule } from '../setting/setting.module';
import { CanaryService } from './canary.service';

@Module({
  imports: [SettingModule],
  exports: [CanaryService],
  providers: [CanaryService],
})
export class CanaryModule {}
