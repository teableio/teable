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
import { HttpErrorCode } from '@teable/core';
import {
  BaseNodeResourceType,
  moveBaseNodeRoSchema,
  createBaseNodeRoSchema,
  duplicateBaseNodeRoSchema,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IMoveBaseNodeRo,
  moveBaseNodeCheckRoSchema,
  IMoveBaseNodeCheckRo,
  type IMoveBaseNodeCheckVo,
  updateBaseNodeRoSchema,
  IUpdateBaseNodeRo,
  type IBaseNodeTreeVo,
  type IBaseNodeVo,
  type IDeleteBaseNodeVo,
  type V2Feature,
} from '@teable/openapi';
import type { Response } from 'express';
import { omit } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { CustomHttpException } from '../../custom.exception';
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
import { BaseNodeMoveService } from './base-node-move.service';
import { filterVisibleNodes } from './base-node.permission.helper';
import { BaseNodeService } from './base-node.service';
import { BaseNodeAction, type IBaseNodeVisibilityContext } from './types';

const omitCollaboratorEmails = <T extends IBaseNodeVo>(node: T): T => {
  if (!node.resourceMeta) return node;
  const { createdByUser, lastModifiedByUser } = node.resourceMeta;
  return {
    ...node,
    resourceMeta: {
      ...node.resourceMeta,
      ...(createdByUser && { createdByUser: omit(createdByUser, 'email') }),
      ...(lastModifiedByUser && { lastModifiedByUser: omit(lastModifiedByUser, 'email') }),
    },
  };
};

// A blank name gets through the body pipe so `update` can answer a table node with its
// localized reason; every other node keeps the schema's own rejection.
export const updateBaseNodeBodySchema = updateBaseNodeRoSchema.extend({
  name: z.string().trim().optional(),
});

@Controller('api/base/:baseId/node')
@UseGuards(BaseNodePermissionGuard)
@AllowAnonymous(AllowAnonymousType.RESOURCE)
export class BaseNodeController {
  protected static readonly createTableV2Feature = 'createTable';
  protected static readonly duplicateTableV2Feature = 'duplicateTable';
  protected static readonly deleteTableV2Feature = 'deleteTable';

  constructor(
    private readonly baseNodeService: BaseNodeService,
    private readonly cls: ClsService<IClsStore>,
    private readonly baseNodeMoveService: BaseNodeMoveService
  ) {}

  @Get('list')
  @Permissions('base|read')
  async getList(@Param('baseId') baseId: string): Promise<IBaseNodeVo[]> {
    return this.getVisibleNodes(baseId, await this.baseNodeService.getList(baseId));
  }

  @Get('tree')
  @Permissions('base|read')
  async getTree(@Param('baseId') baseId: string): Promise<IBaseNodeTreeVo> {
    const tree = await this.baseNodeService.getTree(baseId);
    return { ...tree, nodes: await this.getVisibleNodes(baseId, tree.nodes) };
  }

  private async getVisibleNodes(baseId: string, nodes: IBaseNodeVo[]): Promise<IBaseNodeVo[]> {
    const permissionContext = await this.getPermissionContext(baseId);
    return this.presentNodes(filterVisibleNodes(nodes, permissionContext));
  }

  /**
   * What the caller is shown of these nodes: no reference to a node outside `visibleNodeIds`, and
   * for a share visitor no collaborator's email, which a share hands nobody. Must stay pure: the
   * node list comes from a cache shared by every caller of this base.
   */
  private presentNodes(
    nodes: IBaseNodeVo[],
    visibleNodeIds = new Set(nodes.map((node) => node.id))
  ): IBaseNodeVo[] {
    const hideEmails = Boolean(this.cls.get('baseShare'));
    return nodes.map((node) => {
      const presented = {
        ...node,
        parentId: node.parentId && visibleNodeIds.has(node.parentId) ? node.parentId : null,
        parent: node.parent && visibleNodeIds.has(node.parent.id) ? node.parent : null,
        children: node.children?.filter((child) => visibleNodeIds.has(child.id)),
      };
      return hideEmails ? omitCollaboratorEmails(presented) : presented;
    });
  }

  @Get(':nodeId')
  @Permissions('base|read')
  @BaseNodePermissions(BaseNodeAction.Read)
  async getNode(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<IBaseNodeVo> {
    // Reading a node is reading it out of the caller's tree: one their roles, the matrix or their
    // share keep from the tree is not theirs to read here either, by whichever id it is asked for
    const visibleNodes = await this.getVisibleNodes(
      baseId,
      await this.baseNodeService.getList(baseId)
    );
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    if (!visibleNodeIds.has(nodeId)) {
      throw new CustomHttpException(
        `No permission to read project node ${nodeId}`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        { localization: { i18nKey: 'httpErrors.permission.notAllowedOperation' } }
      );
    }
    const [node] = this.presentNodes(
      [await this.baseNodeService.getNodeVo(baseId, nodeId)],
      visibleNodeIds
    );
    return node;
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
    @Body(new ZodValidationPipe(updateBaseNodeBodySchema)) ro: IUpdateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    if (ro.name === '') {
      await this.rejectBlankNodeName(baseId, nodeId, ro);
    }
    return this.baseNodeService.update(baseId, nodeId, ro);
  }

  protected async rejectBlankNodeName(baseId: string, nodeId: string, ro: IUpdateBaseNodeRo) {
    const node = await this.baseNodeService.getNode(baseId, nodeId);
    if (node.resourceType === BaseNodeResourceType.Table) {
      throw new CustomHttpException('Table name cannot be empty', HttpErrorCode.VALIDATION_ERROR, {
        localization: { i18nKey: 'httpErrors.table.nameRequired' },
      });
    }
    // Throws the schema's own "Too small" rejection.
    new ZodValidationPipe(updateBaseNodeRoSchema).transform(ro, { type: 'body' });
  }

  @Put(':nodeId/move')
  @Permissions('base|update')
  async move(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(moveBaseNodeRoSchema)) ro: IMoveBaseNodeRo
  ): Promise<IBaseNodeVo> {
    if (ro.targetBaseId && ro.targetBaseId !== baseId) {
      const movedNodeId = await this.baseNodeMoveService.move(baseId, nodeId, ro);
      return this.baseNodeService.getNodeVo(ro.targetBaseId, movedNodeId);
    }
    return this.baseNodeService.move(baseId, nodeId, ro);
  }

  @Post(':nodeId/move-check')
  @Permissions('base|update')
  async moveCheck(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(moveBaseNodeCheckRoSchema)) ro: IMoveBaseNodeCheckRo
  ): Promise<IMoveBaseNodeCheckVo> {
    return this.baseNodeMoveService.check(baseId, nodeId, ro.targetBaseId, ro.additionalNodeIds);
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

  protected async getPermissionContext(_baseId: string): Promise<IBaseNodeVisibilityContext> {
    const permissions = this.cls.get('permissions');
    const permissionSet = new Set(permissions);
    const baseShare = this.cls.get('baseShare');
    return {
      permissionSet,
      shareNodeId: baseShare?.nodeId ?? undefined,
    };
  }
}
