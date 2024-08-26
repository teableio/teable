import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import type {
  ICreatePluginVo,
  IGetPluginCenterListVo,
  IGetPluginsVo,
  IGetPluginVo,
  IPluginRegenerateSecretVo,
  IUpdatePluginVo,
} from '@teable/openapi';
import {
  createPluginRoSchema,
  ICreatePluginRo,
  updatePluginRoSchema,
  IUpdatePluginRo,
  getPluginCenterListRoSchema,
  IGetPluginCenterListRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { PluginService } from './plugin.service';

@Controller('api/plugin')
export class PluginController {
  constructor(private readonly pluginService: PluginService) {}

  @Post()
  createPlugin(
    @Body(new ZodValidationPipe(createPluginRoSchema)) data: ICreatePluginRo
  ): Promise<ICreatePluginVo> {
    return this.pluginService.createPlugin(data);
  }

  @Get()
  getPlugins(): Promise<IGetPluginsVo> {
    return this.pluginService.getPlugins();
  }

  @Get(':pluginId')
  getPlugin(@Param('pluginId') pluginId: string): Promise<IGetPluginVo> {
    return this.pluginService.getPlugin(pluginId);
  }

  @Post(':pluginId/regenerate-secret')
  regenerateSecret(@Param('pluginId') pluginId: string): Promise<IPluginRegenerateSecretVo> {
    return this.pluginService.regenerateSecret(pluginId);
  }

  @Put(':pluginId')
  updatePlugin(
    @Param('pluginId') pluginId: string,
    @Body(new ZodValidationPipe(updatePluginRoSchema)) ro: IUpdatePluginRo
  ): Promise<IUpdatePluginVo> {
    return this.pluginService.updatePlugin(pluginId, ro);
  }

  @Delete(':pluginId')
  deletePlugin(@Param('pluginId') pluginId: string): Promise<void> {
    return this.pluginService.delete(pluginId);
  }

  @Get('center/list')
  getPluginCenterList(
    @Query(new ZodValidationPipe(getPluginCenterListRoSchema)) ro: IGetPluginCenterListRo
  ): Promise<IGetPluginCenterListVo> {
    return this.pluginService.getPluginCenterList(ro.positions);
  }
}
