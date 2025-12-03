import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { ChartService } from '../dashboard/chart.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { PluginPanelController } from './plugin-panel.controller';
import { PluginPanelService } from './plugin-panel.service';

@Module({
  imports: [CollaboratorModule, BaseModule, DashboardModule],
  controllers: [PluginPanelController],
  exports: [PluginPanelService],
  providers: [PluginPanelService, ChartService],
})
export class PluginPanelModule {}
