import { Module } from '@nestjs/common';
import { BaseModule } from '../../../base/base.module';
import { DashboardModule } from '../../../dashboard/dashboard.module';
import { PluginPanelModule } from '../../../plugin-panel/plugin-panel.module';
import { PluginChartController } from './plugin-chart.controller';
import { PluginChartService } from './plugin-chart.service';

@Module({
  imports: [PluginPanelModule, DashboardModule, BaseModule],
  providers: [PluginChartService],
  exports: [PluginChartService],
  controllers: [PluginChartController],
})
export class PluginChartModule {}
