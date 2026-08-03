import { Module } from '@nestjs/common';
import { SettingModule } from '../setting/setting.module';
import { CanaryService } from './canary.service';
import { V2FeatureGuard } from './guards/v2-feature.guard';
import { V2IndicatorInterceptor } from './interceptors/v2-indicator.interceptor';

@Module({
  imports: [SettingModule],
  exports: [CanaryService, V2FeatureGuard, V2IndicatorInterceptor],
  providers: [CanaryService, V2FeatureGuard, V2IndicatorInterceptor],
})
export class CanaryModule {}
