/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  BaseNodeResourceType,
  moveBaseNodeRoSchema,
  createBaseNodeRoSchema,
  duplicateBaseNodeRoSchema,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IMoveBaseNodeRo,
  updateBaseNodeRoSchema,
  IUpdateBaseNodeRo,
  type IBaseNodeTreeVo,
  type IBaseNodeVo,
  type IDeleteBaseNodeVo,
  type V2Feature,
} from '@teable/openapi';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { EmitControllerEvent } from '../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AllowAnonymous, AllowAnonymousType } from '../auth/decorators/allow-anonymous.decorator';
import { BaseNodePermissions } from '../auth/decorators/base-node-permissions.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BaseNodePermissionGuard } from '../auth/guard/base-node-permission.guard';
import type { IV2Decision } from '../canary/canary.service';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../canary/interceptors/v2-indicator.interceptor';
import { checkBaseNodePermission } from './base-node.permission.helper';
import { BaseNodeService } from './base-node.service';
import { BaseNodeAction } from './types';

@Controller('api/base/:baseId/node')
@UseGuards(BaseNodePermissionGuard)
@AllowAnonymous(AllowAnonymousType.RESOURCE)
export class BaseNodeController {
  protected static readonly createTableV2Feature = 'createTable';
  protected static readonly duplicateTableV2Feature = 'duplicateTable';
  protected static readonly deleteTableV2Feature = 'deleteTable';

  constructor(
    private readonly baseNodeService: BaseNodeService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Get('list')
  @Permissions('base|read')
  async getList(@Param('baseId') baseId: string): Promise<IBaseNodeVo[]> {
    const permissionContext = await this.getPermissionContext(baseId);
    const nodeList = await this.baseNodeService.getList(baseId);
    const allowedNodeIds = this.getAllowedNodeIds(nodeList, permissionContext.shareNodeId);
    return nodeList.filter((node) => this.filterNode(node, permissionContext, allowedNodeIds));
  }

  @Get('tree')
  @Permissions('base|read')
  async getTree(@Param('baseId') baseId: string): Promise<IBaseNodeTreeVo> {
    const permissionContext = await this.getPermissionContext(baseId);
    const tree = await this.baseNodeService.getTree(baseId);
    const allowedNodeIds = this.getAllowedNodeIds(tree.nodes, permissionContext.shareNodeId);
    return {
      ...tree,
      nodes: tree.nodes.filter((node) => this.filterNode(node, permissionContext, allowedNodeIds)),
    };
  }

  private filterNode(
    node: IBaseNodeVo,
    permissionContext: { permissionSet: Set<string>; shareNodeId?: string },
    allowedNodeIds?: Set<string>
  ): boolean {
    if (allowedNodeIds && !allowedNodeIds.has(node.id)) {
      return false;
    }

    // Then check standard permissions
    return checkBaseNodePermission(
      { resourceType: node.resourceType, resourceId: node.resourceId },
      BaseNodeAction.Read,
      permissionContext
    );
  }

  protected getAllowedNodeIds(nodes: IBaseNodeVo[], shareNodeId?: string) {
    if (!shareNodeId) {
      return undefined;
    }
    const nodeIds = new Set(nodes.map((node) => node.id));
    if (!nodeIds.has(shareNodeId)) {
      return new Set<string>();
    }
    const childrenByParent = new Map<string, string[]>();
    for (const node of nodes) {
      if (!node.parentId) {
        continue;
      }
      const current = childrenByParent.get(node.parentId) ?? [];
      current.push(node.id);
      childrenByParent.set(node.parentId, current);
    }
    const allowed = new Set<string>();
    const queue = [shareNodeId];
    while (queue.length) {
      const current = queue.shift();
      if (!current || allowed.has(current)) {
        continue;
      }
      allowed.add(current);
      const children = childrenByParent.get(current) ?? [];
      for (const childId of children) {
        if (!allowed.has(childId)) {
          queue.push(childId);
        }
      }
    }
    return allowed;
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
    @Body(new ZodValidationPipe(createBaseNodeRoSchema)) ro: ICreateBaseNodeRo,
    @Headers('x-window-id') windowId: string | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<IBaseNodeVo> {
    await this.prepareCreateTableCanary(baseId, ro, response, windowId);
    return this.baseNodeService.create(baseId, ro);
  }

  @Post(':nodeId/duplicate')
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Read, BaseNodeAction.Create)
  @EmitControllerEvent(Events.BASE_NODE_CREATE)
  async duplicate(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(duplicateBaseNodeRoSchema)) ro: IDuplicateBaseNodeRo,
    @Headers('x-window-id') windowId: string | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<IBaseNodeVo> {
    await this.prepareDuplicateTableCanary(baseId, nodeId, response, windowId);
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
    @Param('nodeId') nodeId: string,
    @Headers('x-window-id') windowId: string | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<IDeleteBaseNodeVo> {
    await this.prepareDeleteTableCanary(baseId, nodeId, response, windowId);
    return this.baseNodeService.delete(baseId, nodeId);
  }

  @Delete(':nodeId/permanent')
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Delete)
  @EmitControllerEvent(Events.BASE_NODE_DELETE)
  async permanentDelete(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Headers('x-window-id') windowId: string | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<IDeleteBaseNodeVo> {
    await this.prepareDeleteTableCanary(baseId, nodeId, response, windowId);
    const result = await this.baseNodeService.delete(baseId, nodeId, true);
    return { ...result, permanent: true };
  }

  protected async prepareDeleteTableCanary(
    baseId: string,
    nodeId: string,
    response: Response,
    windowId?: string
  ): Promise<void> {
    await this.prepareTableNodeCanary(
      baseId,
      nodeId,
      response,
      BaseNodeController.deleteTableV2Feature,
      windowId
    );
  }

  protected async prepareDuplicateTableCanary(
    baseId: string,
    nodeId: string,
    response: Response,
    windowId?: string
  ): Promise<void> {
    await this.prepareTableNodeCanary(
      baseId,
      nodeId,
      response,
      BaseNodeController.duplicateTableV2Feature,
      windowId
    );
  }

  protected async prepareCreateTableCanary(
    baseId: string,
    createRo: ICreateBaseNodeRo,
    response: Response,
    windowId?: string
  ): Promise<void> {
    if (windowId) {
      this.cls.set('windowId', windowId);
    }

    if (createRo.resourceType !== BaseNodeResourceType.Table) {
      return;
    }

    const decision = await this.baseNodeService.getCreateTableV2Decision(baseId);
    if (!decision) {
      return;
    }

    this.applyV2Decision(response, BaseNodeController.createTableV2Feature, decision);
  }

  protected async prepareTableNodeCanary(
    baseId: string,
    nodeId: string,
    response: Response,
    feature: V2Feature,
    windowId?: string
  ): Promise<void> {
    if (windowId) {
      this.cls.set('windowId', windowId);
    }

    const node = await this.baseNodeService.getNode(baseId, nodeId);
    if (node.resourceType !== BaseNodeResourceType.Table) {
      return;
    }

    const decision = await this.baseNodeService.getTableV2Decision(baseId, nodeId, feature);
    if (!decision) {
      return;
    }

    this.applyV2Decision(response, feature, decision);
  }

  protected applyV2Decision(response: Response, feature: V2Feature, decision: IV2Decision) {
    this.cls.set('useV2', decision.useV2);
    this.cls.set('v2Feature', feature);
    this.cls.set('v2Reason', decision.reason);

    response.setHeader(X_TEABLE_V2_HEADER, decision.useV2 ? 'true' : 'false');
    response.setHeader(X_TEABLE_V2_FEATURE_HEADER, feature);
    response.setHeader(X_TEABLE_V2_REASON_HEADER, decision.reason);
  }

  protected async getPermissionContext(_baseId: string) {
    const permissions = this.cls.get('permissions');
    const permissionSet = new Set(permissions);
    const baseShare = this.cls.get('baseShare');
    return {
      permissionSet,
      shareNodeId: baseShare?.nodeId ?? undefined,
    };
  }
}
