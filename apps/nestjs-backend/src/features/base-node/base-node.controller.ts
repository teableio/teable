/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { IBaseNodeTreeVo, IBaseNodeVo, IDeleteBaseNodeVo } from '@teable/openapi';
import {
  moveBaseNodeRoSchema,
  createBaseNodeRoSchema,
  duplicateBaseNodeRoSchema,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IMoveBaseNodeRo,
  updateBaseNodeRoSchema,
  IUpdateBaseNodeRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { EmitControllerEvent } from '../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AllowAnonymous } from '../auth/decorators/allow-anonymous.decorator';
import { BaseNodePermissions } from '../auth/decorators/base-node-permissions.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BaseNodePermissionGuard } from '../auth/guard/base-node-permission.guard';
import { checkBaseNodePermission } from './base-node.permission.helper';
import { BaseNodeService } from './base-node.service';
import { BaseNodeAction } from './types';

@Controller('api/base/:baseId/node')
@UseGuards(BaseNodePermissionGuard)
@AllowAnonymous()
export class BaseNodeController {
  constructor(
    private readonly baseNodeService: BaseNodeService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Get('list')
  @Permissions('base|read')
  async getList(@Param('baseId') baseId: string): Promise<IBaseNodeVo[]> {
    const permissionContext = await this.getPermissionContext(baseId);
    const nodeList = await this.baseNodeService.getList(baseId);
    return nodeList.filter((node) =>
      checkBaseNodePermission(
        { resourceType: node.resourceType, resourceId: node.resourceId },
        BaseNodeAction.Read,
        permissionContext
      )
    );
  }

  @Get('tree')
  @Permissions('base|read')
  async getTree(@Param('baseId') baseId: string): Promise<IBaseNodeTreeVo> {
    const permissionContext = await this.getPermissionContext(baseId);
    const tree = await this.baseNodeService.getTree(baseId);
    return {
      ...tree,
      nodes: tree.nodes.filter((node) =>
        checkBaseNodePermission(
          { resourceType: node.resourceType, resourceId: node.resourceId },
          BaseNodeAction.Read,
          permissionContext
        )
      ),
    };
  }

  @Get(':nodeId')
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Read)
  async getNode(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.getNodeVo(baseId, nodeId);
  }

  @Post()
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Create)
  @EmitControllerEvent(Events.BASE_NODE_CREATE)
  async create(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createBaseNodeRoSchema)) ro: ICreateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.create(baseId, ro);
  }

  @Post(':nodeId/duplicate')
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Read, BaseNodeAction.Create)
  @EmitControllerEvent(Events.BASE_NODE_CREATE)
  async duplicate(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(duplicateBaseNodeRoSchema)) ro: IDuplicateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.duplicate(baseId, nodeId, ro);
  }

  @Put(':nodeId')
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Update)
  @EmitControllerEvent(Events.BASE_NODE_UPDATE)
  async update(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(updateBaseNodeRoSchema)) ro: IUpdateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.update(baseId, nodeId, ro);
  }

  @Put(':nodeId/move')
  @Permissions('base|update')
  async move(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(moveBaseNodeRoSchema)) ro: IMoveBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.move(baseId, nodeId, ro);
  }

  @Delete(':nodeId')
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Delete)
  @EmitControllerEvent(Events.BASE_NODE_DELETE)
  async delete(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<IDeleteBaseNodeVo> {
    return this.baseNodeService.delete(baseId, nodeId);
  }

  @Delete(':nodeId/permanent')
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Delete)
  @EmitControllerEvent(Events.BASE_NODE_DELETE)
  async permanentDelete(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<IDeleteBaseNodeVo> {
    const result = await this.baseNodeService.delete(baseId, nodeId, true);
    return { ...result, permanent: true };
  }

  protected async getPermissionContext(_baseId: string) {
    const permissions = this.cls.get('permissions');
    const permissionSet = new Set(permissions);
    return { permissionSet };
  }
}
