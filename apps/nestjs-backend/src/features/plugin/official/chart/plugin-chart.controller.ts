import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  getDashboardInstallPluginQueryRoSchema,
  getPluginPanelInstallPluginQueryRoSchema,
  IGetPluginPanelInstallPluginQueryRo,
  ITestSqlRo,
  testSqlRoSchema,
  IGetDashboardInstallPluginQueryRo,
} from '@teable/openapi';
import type { IBaseQueryVoV2, IBaseQueryVo, IBaseTableSchemaVo } from '@teable/openapi';
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

  @Get(':pluginInstallId/dashboard/:positionId/query/v2')
  @Permissions('base|read')
  @ResourceMeta('baseId', 'query')
  getDashboardPluginQueryV2(
    @Param('pluginInstallId') pluginInstallId: string,
    @Param('positionId') positionId: string,
    @Query('baseId') baseId: string
  ): Promise<IBaseQueryVoV2> {
    return this.pluginChartService.getDashboardPluginQueryV2(baseId, pluginInstallId, positionId);
  }

  @Get(':pluginInstallId/plugin-panel/:positionId/query/v2')
  @Permissions('table|read')
  @ResourceMeta('tableId', 'query')
  getPluginPanelPluginQueryV2(
    @Param('pluginInstallId') pluginInstallId: string,
    @Param('positionId') positionId: string,
    @Query('tableId') tableId: string
  ): Promise<IBaseQueryVoV2> {
    return this.pluginChartService.getPluginPanelPluginQueryV2(
      tableId,
      pluginInstallId,
      positionId
    );
  }

  @Post('test-sql')
  @Permissions('base|read')
  @ResourceMeta('baseId', 'body')
  testSql(
    @Body(new ZodValidationPipe(testSqlRoSchema)) testSqlRo: ITestSqlRo
  ): Promise<IBaseQueryVoV2> {
    return this.pluginChartService.testSql(testSqlRo);
  }

  @Get(':baseId/schema')
  @Permissions('base|read')
  @ResourceMeta('baseId', 'params')
  getSchemaByBaseId(@Param('baseId') baseId: string): Promise<IBaseTableSchemaVo> {
    return this.pluginChartService.getSchemaByBaseId(baseId);
  }
}
