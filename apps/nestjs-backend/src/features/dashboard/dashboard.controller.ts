/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createDashboardRoSchema,
  dashboardInstallPluginRoSchema,
  ICreateDashboardRo,
  IRenameDashboardRo,
  IUpdateLayoutDashboardRo,
  renameDashboardRoSchema,
  updateLayoutDashboardRoSchema,
  IDashboardInstallPluginRo,
  dashboardPluginUpdateStorageRoSchema,
  IDashboardPluginUpdateStorageRo,
  duplicateDashboardRoSchema,
  IDuplicateDashboardRo,
  duplicateDashboardInstalledPluginRoSchema,
  IDuplicateDashboardInstalledPluginRo,
} from '@teable/openapi';
import type {
  ICreateDashboardVo,
  IGetDashboardVo,
  IRenameDashboardVo,
  IUpdateLayoutDashboardVo,
  IGetDashboardListVo,
  IDashboardInstallPluginVo,
  IDashboardPluginUpdateStorageVo,
  IGetDashboardInstallPluginVo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { DashboardService } from './dashboard.service';

@Controller('api/base/:baseId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @Permissions('base|read')
  getDashboard(@Param('baseId') baseId: string): Promise<IGetDashboardListVo> {
    return this.dashboardService.getDashboard(baseId);
  }

  @Get(':id')
  @Permissions('base|read')
  getDashboardById(
    @Param('baseId') baseId: string,
    @Param('id') id: string
  ): Promise<IGetDashboardVo> {
    return this.dashboardService.getDashboardById(baseId, id);
  }

  @Post()
  @Permissions('base|update')
  createDashboard(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createDashboardRoSchema)) ro: ICreateDashboardRo
  ): Promise<ICreateDashboardVo> {
    return this.dashboardService.createDashboard(baseId, ro);
  }

  @Patch(':id/rename')
  @Permissions('base|update')
  updateDashboard(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameDashboardRoSchema)) ro: IRenameDashboardRo
  ): Promise<IRenameDashboardVo> {
    return this.dashboardService.renameDashboard(baseId, id, ro.name);
  }

  @Patch(':id/layout')
  @Permissions('base|update')
  updateLayout(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLayoutDashboardRoSchema)) ro: IUpdateLayoutDashboardRo
  ): Promise<IUpdateLayoutDashboardVo> {
    return this.dashboardService.updateLayout(baseId, id, ro.layout);
  }

  @Delete(':id')
  @Permissions('base|update')
  deleteDashboard(@Param('baseId') baseId: string, @Param('id') id: string): Promise<void> {
    return this.dashboardService.deleteDashboard(baseId, id);
  }

  @Post(':id/duplicate')
  @Permissions('base|update')
  duplicateDashboard(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(duplicateDashboardRoSchema))
    duplicateDashboardRo: IDuplicateDashboardRo
  ): Promise<{ id: string; name: string }> {
    return this.dashboardService.duplicateDashboard(baseId, id, duplicateDashboardRo);
  }

  @Post(':id/plugin/:pluginInstallId/duplicate')
  @Permissions('base|update')
  duplicateDashboardInstalledPlugin(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(duplicateDashboardInstalledPluginRoSchema))
    duplicateDashboardInstalledPluginRo: IDuplicateDashboardInstalledPluginRo
  ): Promise<{ id: string; name: string }> {
    return this.dashboardService.duplicateDashboardInstalledPlugin(
      baseId,
      id,
      pluginInstallId,
      duplicateDashboardInstalledPluginRo
    );
  }

  @Post(':id/plugin')
  @Permissions('base|update')
  installPlugin(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dashboardInstallPluginRoSchema)) ro: IDashboardInstallPluginRo
  ): Promise<IDashboardInstallPluginVo> {
    return this.dashboardService.installPlugin(baseId, id, ro);
  }

  @Delete(':id/plugin/:pluginInstallId')
  @Permissions('base|update')
  removePlugin(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Param('pluginInstallId') pluginInstallId: string
  ): Promise<void> {
    return this.dashboardService.removePlugin(baseId, id, pluginInstallId);
  }

  @Patch(':id/plugin/:pluginInstallId/rename')
  @Permissions('base|update')
  renamePlugin(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(renameDashboardRoSchema)) ro: IRenameDashboardRo
  ): Promise<IRenameDashboardVo> {
    return this.dashboardService.renamePlugin(baseId, id, pluginInstallId, ro.name);
  }

  @Patch(':id/plugin/:pluginInstallId/update-storage')
  @Permissions('base|update')
  updatePluginStorage(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(dashboardPluginUpdateStorageRoSchema))
    ro: IDashboardPluginUpdateStorageRo
  ): Promise<IDashboardPluginUpdateStorageVo> {
    return this.dashboardService.updatePluginStorage(baseId, id, pluginInstallId, ro.storage);
  }

  @Get(':id/plugin/:pluginInstallId')
  @Permissions('base|read')
  getPluginInstall(
    @Param('baseId') baseId: string,
    @Param('id') id: string,
    @Param('pluginInstallId') pluginInstallId: string
  ): Promise<IGetDashboardInstallPluginVo> {
    return this.dashboardService.getPluginInstall(baseId, id, pluginInstallId);
  }
}
