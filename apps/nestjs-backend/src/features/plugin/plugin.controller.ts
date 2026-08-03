import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type {
  ICreatePluginVo,
  IGetPluginCenterListVo,
  IGetPluginsVo,
  IGetPluginVo,
  IPluginGetTokenVo,
  IPluginRefreshTokenVo,
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
  pluginGetTokenRoSchema,
  IPluginGetTokenRo,
  pluginRefreshTokenRoSchema,
  IPluginRefreshTokenRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { PluginAuthService } from './plugin-auth.service';
import { PluginService } from './plugin.service';

@Controller('api/plugin')
export class PluginController {
  constructor(
    private readonly pluginService: PluginService,
    private readonly pluginAuthService: PluginAuthService
  ) {}

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
    return this.pluginService.getPluginCenterList(ro.positions, ro.ids);
  }

  @Patch(':pluginId/submit')
  submitPlugin(@Param('pluginId') pluginId: string): Promise<void> {
    return this.pluginService.submitPlugin(pluginId);
  }

  @Patch(':pluginId/unpublish')
  unpublishPlugin(@Param('pluginId') pluginId: string): Promise<void> {
    return this.pluginService.unpublishPlugin(pluginId);
  }

  @Post(':pluginId/token')
  @Public()
  accessToken(
    @Param('pluginId') pluginId: string,
    @Body(new ZodValidationPipe(pluginGetTokenRoSchema)) ro: IPluginGetTokenRo
  ): Promise<IPluginGetTokenVo> {
    return this.pluginAuthService.token(pluginId, ro);
  }

  @Post(':pluginId/refreshToken')
  @Public()
  refreshToken(
    @Param('pluginId') pluginId: string,
    @Body(new ZodValidationPipe(pluginRefreshTokenRoSchema)) ro: IPluginRefreshTokenRo
  ): Promise<IPluginRefreshTokenVo> {
    return this.pluginAuthService.refreshToken(pluginId, ro);
  }

  @Post(':pluginId/authCode')
  @Permissions('base|read')
  @ResourceMeta('baseId', 'body')
  authCode(@Param('pluginId') pluginId: string, @Body('baseId') baseId: string): Promise<string> {
    return this.pluginAuthService.authCode(pluginId, baseId);
  }
}
