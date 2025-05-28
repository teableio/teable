/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type {
  IPluginPanelCreateVo,
  IPluginPanelGetVo,
  IPluginPanelInstallVo,
  IPluginPanelListVo,
  IPluginPanelPluginGetVo,
  IPluginPanelRenameVo,
  IPluginPanelUpdateLayoutVo,
  IPluginPanelUpdateStorageVo,
} from '@teable/openapi';
import {
  IPluginPanelCreateRo,
  pluginPanelCreateRoSchema,
  pluginPanelRenameRoSchema,
  IPluginPanelRenameRo,
  pluginPanelUpdateLayoutRoSchema,
  IPluginPanelUpdateLayoutRo,
  pluginPanelInstallRoSchema,
  IPluginPanelInstallRo,
  pluginPanelUpdateStorageRoSchema,
  IPluginPanelUpdateStorageRo,
  duplicatePluginPanelRoSchema,
  IDuplicatePluginPanelRo,
  duplicatePluginPanelInstalledPluginRoSchema,
  IDuplicatePluginPanelInstalledPluginRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PluginPanelService } from './plugin-panel.service';

@Controller('api/table/:tableId/plugin-panel')
export class PluginPanelController {
  constructor(private readonly pluginPanelService: PluginPanelService) {}

  @Permissions('table|update')
  @Post()
  createPluginPanel(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(pluginPanelCreateRoSchema))
    createPluginPanelDto: IPluginPanelCreateRo
  ): Promise<IPluginPanelCreateVo> {
    return this.pluginPanelService.createPluginPanel(tableId, createPluginPanelDto);
  }

  @Permissions('table|read')
  @Get()
  getPluginPanels(@Param('tableId') tableId: string): Promise<IPluginPanelListVo> {
    return this.pluginPanelService.getPluginPanels(tableId);
  }

  @Permissions('table|read')
  @Get(':pluginPanelId')
  getPluginPanel(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string
  ): Promise<IPluginPanelGetVo> {
    return this.pluginPanelService.getPluginPanel(tableId, pluginPanelId);
  }

  @Permissions('table|update')
  @Patch(':pluginPanelId/rename')
  renamePluginPanel(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Body(new ZodValidationPipe(pluginPanelRenameRoSchema))
    renamePluginPanelDto: IPluginPanelRenameRo
  ): Promise<IPluginPanelRenameVo> {
    return this.pluginPanelService.renamePluginPanel(tableId, pluginPanelId, renamePluginPanelDto);
  }

  @Permissions('table|update')
  @Delete(':pluginPanelId')
  async deletePluginPanel(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string
  ): Promise<void> {
    await this.pluginPanelService.deletePluginPanel(tableId, pluginPanelId);
  }

  @Permissions('table|update')
  @Patch(':pluginPanelId/layout')
  updatePluginPanelLayout(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Body(new ZodValidationPipe(pluginPanelUpdateLayoutRoSchema))
    updatePluginPanelLayoutDto: IPluginPanelUpdateLayoutRo
  ): Promise<IPluginPanelUpdateLayoutVo> {
    return this.pluginPanelService.updatePluginPanelLayout(
      tableId,
      pluginPanelId,
      updatePluginPanelLayoutDto
    );
  }

  @Permissions('table|update')
  @Post(':pluginPanelId/install')
  installPluginPanel(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Body(new ZodValidationPipe(pluginPanelInstallRoSchema))
    installPluginPanelDto: IPluginPanelInstallRo
  ): Promise<IPluginPanelInstallVo> {
    return this.pluginPanelService.installPluginPanel(
      tableId,
      pluginPanelId,
      installPluginPanelDto
    );
  }

  @Permissions('table|update')
  @Delete(':pluginPanelId/plugin/:pluginInstallId')
  removePluginPanelPlugin(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Param('pluginInstallId') pluginInstallId: string
  ): Promise<void> {
    return this.pluginPanelService.removePluginPanelPlugin(tableId, pluginPanelId, pluginInstallId);
  }

  @Permissions('table|update')
  @Patch(':pluginPanelId/plugin/:pluginInstallId/rename')
  renamePluginPanelPlugin(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(pluginPanelRenameRoSchema))
    renamePluginPanelPluginDto: IPluginPanelRenameRo
  ): Promise<IPluginPanelRenameVo> {
    return this.pluginPanelService.renamePluginPanelPlugin(
      tableId,
      pluginPanelId,
      pluginInstallId,
      renamePluginPanelPluginDto
    );
  }

  @Permissions('table|update')
  @Patch(':pluginPanelId/plugin/:pluginInstallId/update-storage')
  updatePluginPanelPluginStorage(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(pluginPanelUpdateStorageRoSchema))
    updatePluginPanelPluginStorageDto: IPluginPanelUpdateStorageRo
  ): Promise<IPluginPanelUpdateStorageVo> {
    return this.pluginPanelService.updatePluginPanelPluginStorage(
      tableId,
      pluginPanelId,
      pluginInstallId,
      updatePluginPanelPluginStorageDto
    );
  }

  @Permissions('table|read')
  @Get(':pluginPanelId/plugin/:pluginInstallId')
  getPluginPanelPlugin(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Param('pluginInstallId') pluginInstallId: string
  ): Promise<IPluginPanelPluginGetVo> {
    return this.pluginPanelService.getPluginPanelPlugin(tableId, pluginPanelId, pluginInstallId);
  }

  @Post(':pluginPanelId/duplicate')
  @Permissions('table|update')
  duplicatePluginPanel(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Body(new ZodValidationPipe(duplicatePluginPanelRoSchema))
    duplicatePluginPanelDto: IDuplicatePluginPanelRo
  ): Promise<{ id: string; name: string }> {
    return this.pluginPanelService.duplicatePluginPanel(
      tableId,
      pluginPanelId,
      duplicatePluginPanelDto
    );
  }

  @Post(':pluginPanelId/plugin/:pluginInstallId/duplicate')
  @Permissions('table|update')
  duplicatePluginPanelPlugin(
    @Param('tableId') tableId: string,
    @Param('pluginPanelId') pluginPanelId: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(duplicatePluginPanelInstalledPluginRoSchema))
    duplicatePluginPanelInstalledPluginDto: IDuplicatePluginPanelInstalledPluginRo
  ): Promise<{ id: string; name: string }> {
    return this.pluginPanelService.duplicatePluginPanelPlugin(
      tableId,
      pluginPanelId,
      pluginInstallId,
      duplicatePluginPanelInstalledPluginDto
    );
  }
}
