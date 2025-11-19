import { Module } from '@nestjs/common';
import { BaseModule } from '../../../base/base.module';
import { BaseSqlExecutorModule } from '../../../base-sql-executor/base-sql-executor.module';
import { DashboardModule } from '../../../dashboard/dashboard.module';
import { FieldModule } from '../../../field/field.module';
import { PluginPanelModule } from '../../../plugin-panel/plugin-panel.module';
import { RecordModule } from '../../../record/record.module';
import { PluginChartController } from './plugin-chart.controller';
import { PluginChartService } from './plugin-chart.service';

@Module({
  imports: [
    PluginPanelModule,
    DashboardModule,
    BaseModule,
    RecordModule,
    FieldModule,
    BaseSqlExecutorModule,
  ],
  providers: [PluginChartService],
  exports: [PluginChartService],
  controllers: [PluginChartController],
})
export class PluginChartModule {}
