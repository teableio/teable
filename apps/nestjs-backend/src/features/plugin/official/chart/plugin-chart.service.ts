import { Injectable, NotFoundException } from '@nestjs/common';
import { CellFormat } from '@teable/core';
import type { IBaseQuery } from '@teable/openapi';
import { BaseQueryService } from '../../../base/base-query/base-query.service';
import { DashboardService } from '../../../dashboard/dashboard.service';
import { PluginPanelService } from '../../../plugin-panel/plugin-panel.service';

@Injectable()
export class PluginChartService {
  constructor(
    private readonly baseQueryService: BaseQueryService,
    private readonly dashboardService: DashboardService,
    private readonly pluginPanelService: PluginPanelService
  ) {}

  async getDashboardPluginQuery(
    pluginInstallId: string,
    positionId: string,
    baseId: string,
    cellFormat: CellFormat = CellFormat.Text
  ) {
    const { storage } = await this.dashboardService.getPluginInstall(
      baseId,
      positionId,
      pluginInstallId
    );
    const query = storage?.query as IBaseQuery;
    if (!query) {
      throw new NotFoundException('Dashboard Plugin Storage Query not found');
    }
    return this.baseQueryService.baseQuery(baseId, query, cellFormat);
  }

  async getPluginPanelPluginQuery(
    pluginInstallId: string,
    positionId: string,
    tableId: string,
    cellFormat: CellFormat = CellFormat.Text
  ) {
    const { baseId, storage } = await this.pluginPanelService.getPluginPanelPlugin(
      tableId,
      positionId,
      pluginInstallId
    );
    const query = storage?.query as IBaseQuery;
    if (!query) {
      throw new NotFoundException('Plugin Panel Plugin Storage Query not found');
    }
    return this.baseQueryService.baseQuery(baseId, query, cellFormat);
  }
}
