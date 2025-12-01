/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { IBaseNodeTreeVo, IBaseNodeVo } from '@teable/openapi';
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
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { BaseNodePermissions } from '../auth/decorators/base-node-permissions.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BaseNodePermissionGuard } from '../auth/guard/base-node-permission.guard';
import { checkBaseNodePermission } from './base-node.permission.helper';
import { BaseNodeService } from './base-node.service';

@Controller('api/base/:baseId/node')
@UseGuards(BaseNodePermissionGuard)
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
        'base_node|read',
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
          'base_node|read',
          permissionContext
        )
      ),
    };
  }

  @Get(':nodeId')
  @Permissions('base|read')
  @BaseNodePermissions('base_node|read')
  async getNode(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.getNodeVo(baseId, nodeId);
  }

  @Post()
  @Permissions('base|read')
  @BaseNodePermissions('base_node|create')
  async create(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createBaseNodeRoSchema)) ro: ICreateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.create(baseId, ro);
  }

  @Post(':nodeId/duplicate')
  @Permissions('base|read')
  @BaseNodePermissions('base_node|read', 'base_node|create')
  async duplicate(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(duplicateBaseNodeRoSchema)) ro: IDuplicateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.duplicate(baseId, nodeId, ro);
  }

  @Put(':nodeId')
  @Permissions('base|read')
  @BaseNodePermissions('base_node|update')
  async update(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(updateBaseNodeRoSchema)) ro: IUpdateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.update(baseId, nodeId, ro);
  }

  @Put(':nodeId/move')
  @Permissions('base|update')
  @BaseNodePermissions('base_node|update')
  async move(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(moveBaseNodeRoSchema)) ro: IMoveBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.move(baseId, nodeId, ro);
  }

  @Delete(':nodeId')
  @Permissions('base|read')
  @BaseNodePermissions('base_node|delete')
  async delete(@Param('baseId') baseId: string, @Param('nodeId') nodeId: string): Promise<void> {
    return this.baseNodeService.delete(baseId, nodeId);
  }

  @Delete(':nodeId/permanent')
  @Permissions('base|read')
  @BaseNodePermissions('base_node|delete')
  async permanentDelete(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<void> {
    return this.baseNodeService.delete(baseId, nodeId, true);
  }

  protected async getPermissionContext(_baseId: string) {
    const permissions = this.cls.get('permissions');
    const permissionSet = new Set(permissions);
    return { permissionSet };
  }
}
