/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import type {
  IPluginContextMenuGetItem,
  IPluginContextMenuGetStorageVo,
  IPluginContextMenuGetVo,
  IPluginContextMenuInstallVo,
  IPluginContextMenuRenameVo,
  IPluginContextMenuUpdateStorageVo,
} from '@teable/openapi';
import {
  IPluginContextMenuInstallRo,
  pluginContextMenuInstallRoSchema,
  pluginContextMenuRenameRoSchema,
  IPluginContextMenuRenameRo,
  pluginContextMenuUpdateStorageRoSchema,
  pluginContextMenuMoveRoSchema,
  IPluginContextMenuMoveRo,
  IPluginContextMenuUpdateStorageRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PluginContextMenuService } from './plugin-context-menu.service';

@Controller('api/table/:tableId/plugin-context-menu')
export class PluginContextMenuController {
  constructor(private readonly pluginContextMenuService: PluginContextMenuService) {}

  @Post('install')
  @Permissions('table|update')
  async installPluginContextMenu(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(pluginContextMenuInstallRoSchema))
    body: IPluginContextMenuInstallRo
  ): Promise<IPluginContextMenuInstallVo> {
    return this.pluginContextMenuService.installPluginContextMenu(tableId, body);
  }

  @Get()
  @Permissions('table|read')
  async getPluginContextMenuList(
    @Param('tableId') tableId: string
  ): Promise<IPluginContextMenuGetItem[]> {
    return this.pluginContextMenuService.getPluginContextMenuList(tableId);
  }

  @Get(':pluginInstallId')
  @Permissions('table|read')
  async getPluginContextMenu(
    @Param('tableId') tableId: string,
    @Param('pluginInstallId') pluginInstallId: string
  ): Promise<IPluginContextMenuGetVo> {
    return this.pluginContextMenuService.getPluginContextMenu(tableId, pluginInstallId);
  }

  @Get(':pluginInstallId/storage')
  @Permissions('table|read')
  async getPluginContextMenuStorage(
    @Param('tableId') tableId: string,
    @Param('pluginInstallId') pluginInstallId: string
  ): Promise<IPluginContextMenuGetStorageVo> {
    return this.pluginContextMenuService.getPluginContextMenuStorage(tableId, pluginInstallId);
  }

  @Patch(':pluginInstallId/rename')
  @Permissions('table|update')
  async renamePluginContextMenu(
    @Param('tableId') tableId: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(pluginContextMenuRenameRoSchema))
    body: IPluginContextMenuRenameRo
  ): Promise<IPluginContextMenuRenameVo> {
    return this.pluginContextMenuService.renamePluginContextMenu(tableId, pluginInstallId, body);
  }

  @Put(':pluginInstallId/update-storage')
  @Permissions('table|update')
  async updatePluginContextMenuStorage(
    @Param('tableId') tableId: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(pluginContextMenuUpdateStorageRoSchema))
    body: IPluginContextMenuUpdateStorageRo
  ): Promise<IPluginContextMenuUpdateStorageVo> {
    return this.pluginContextMenuService.updatePluginContextMenuStorage(
      tableId,
      pluginInstallId,
      body
    );
  }

  @Delete(':pluginInstallId')
  @Permissions('table|update')
  async removePluginContextMenu(
    @Param('tableId') tableId: string,
    @Param('pluginInstallId') pluginInstallId: string
  ): Promise<void> {
    return this.pluginContextMenuService.deletePluginContextMenu(tableId, pluginInstallId);
  }

  @Put(':pluginInstallId/move')
  @Permissions('table|update')
  async movePluginContextMenu(
    @Param('tableId') tableId: string,
    @Param('pluginInstallId') pluginInstallId: string,
    @Body(new ZodValidationPipe(pluginContextMenuMoveRoSchema))
    body: IPluginContextMenuMoveRo
  ): Promise<void> {
    return this.pluginContextMenuService.movePluginContextMenu(tableId, pluginInstallId, body);
  }
}
