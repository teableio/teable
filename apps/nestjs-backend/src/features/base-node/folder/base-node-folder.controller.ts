/* eslint-disable sonarjs/no-duplicate-string */
import { Controller, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import type { ICreateBaseNodeFolderVo, IUpdateBaseNodeFolderVo } from '@teable/openapi';
import {
  createBaseNodeFolderRoSchema,
  ICreateBaseNodeFolderRo,
  updateBaseNodeFolderRoSchema,
  IUpdateBaseNodeFolderRo,
} from '@teable/openapi';
import { EmitControllerEvent } from '../../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../../event-emitter/events';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { BaseNodeFolderService } from './base-node-folder.service';

@Controller('api/base/:baseId/node/folder')
export class BaseNodeFolderController {
  constructor(private readonly baseNodeFolderService: BaseNodeFolderService) {}

  @Post()
  @Permissions('base|update')
  @EmitControllerEvent(Events.BASE_FOLDER_CREATE)
  async createFolder(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createBaseNodeFolderRoSchema)) ro: ICreateBaseNodeFolderRo
  ): Promise<ICreateBaseNodeFolderVo> {
    return this.baseNodeFolderService.createFolder(baseId, ro);
  }

  @Patch(':folderId')
  @Permissions('base|update')
  @EmitControllerEvent(Events.BASE_FOLDER_UPDATE)
  async renameFolder(
    @Param('baseId') baseId: string,
    @Param('folderId') folderId: string,
    @Body(new ZodValidationPipe(updateBaseNodeFolderRoSchema)) ro: IUpdateBaseNodeFolderRo
  ): Promise<IUpdateBaseNodeFolderVo> {
    return this.baseNodeFolderService.renameFolder(baseId, folderId, ro);
  }

  @Delete(':folderId')
  @Permissions('base|update')
  @EmitControllerEvent(Events.BASE_FOLDER_DELETE)
  async deleteFolder(@Param('baseId') baseId: string, @Param('folderId') folderId: string) {
    return this.baseNodeFolderService.deleteFolder(baseId, folderId);
  }
}
