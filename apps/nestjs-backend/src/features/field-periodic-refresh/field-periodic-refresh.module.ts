import { Module } from '@nestjs/common';
import { V2Module } from '../v2/v2.module';
import { FieldPeriodicRefreshStateService } from './field-periodic-refresh-state.service';
import { FieldPeriodicRefreshService } from './field-periodic-refresh.service';
import { PeriodicRefreshMetricsService } from './periodic-refresh-metrics.service';
import { V2PeriodicRefreshSyncProjection } from './v2-periodic-refresh-sync.projection';

@Module({
  imports: [V2Module],
  providers: [
    FieldPeriodicRefreshStateService,
    FieldPeriodicRefreshService,
    PeriodicRefreshMetricsService,
    V2PeriodicRefreshSyncProjection,
  ],
  exports: [
    FieldPeriodicRefreshStateService,
    FieldPeriodicRefreshService,
    PeriodicRefreshMetricsService,
  ],
})
export class FieldPeriodicRefreshModule {}
