import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  getDashboardInstallPluginQueryRoSchema,
  getPluginPanelInstallPluginQueryRoSchema,
  IGetDashboardInstallPluginQueryRo,
  IGetPluginPanelInstallPluginQueryRo,
  type IBaseQueryVo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../../zod.validation.pipe';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../../../auth/decorators/resource_meta.decorator';
import { PluginChartService } from './plugin-chart.service';

@Controller('api/plugin/chart')
export class PluginChartController {
  constructor(private readonly pluginChartService: PluginChartService) {}

  @Get(':pluginInstallId/plugin-panel/:positionId/query')
  @Permissions('table|read')
  @ResourceMeta('tableId', 'query')
  getPluginPanelPluginQuery(
    @Param('pluginInstallId') pluginInstallId: string,
    @Param('positionId') positionId: string,
    @Query(new ZodValidationPipe(getPluginPanelInstallPluginQueryRoSchema))
    query: IGetPluginPanelInstallPluginQueryRo
  ): Promise<IBaseQueryVo> {
    const { tableId, cellFormat } = query;
    return this.pluginChartService.getPluginPanelPluginQuery(
      pluginInstallId,
      positionId,
      tableId,
      cellFormat
    );
  }

  @Get(':pluginInstallId/dashboard/:positionId/query')
  @Permissions('base|read')
  @ResourceMeta('baseId', 'query')
  getDashboardPluginQuery(
    @Param('pluginInstallId') pluginInstallId: string,
    @Param('positionId') positionId: string,
    @Query(new ZodValidationPipe(getDashboardInstallPluginQueryRoSchema))
    query: IGetDashboardInstallPluginQueryRo
  ): Promise<IBaseQueryVo> {
    const { baseId, cellFormat } = query;
    return this.pluginChartService.getDashboardPluginQuery(
      pluginInstallId,
      positionId,
      baseId,
      cellFormat
    );
  }
}
