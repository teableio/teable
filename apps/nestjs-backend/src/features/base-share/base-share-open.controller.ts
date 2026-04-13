import { Body, Controller, Get, HttpCode, Post, Res, UseGuards, Request } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  BaseDuplicateMode,
  copyBaseShareRoSchema,
  ICopyBaseShareRo,
  type IGetBaseShareVo,
  type IBaseShareAuthVo,
  type ICopyBaseShareVo,
} from '@teable/openapi';
import { Response } from 'express';
import { CustomHttpException } from '../../custom.exception';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AllowAnonymous } from '../auth/decorators/allow-anonymous.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { PermissionService } from '../auth/permission.service';
import { BaseDuplicateService } from '../base/base-duplicate.service';
import type { IBaseShareInfo } from './base-share-auth.service';
import { BaseShareAuthService } from './base-share-auth.service';
import { BaseShareAuthLocalGuard } from './guard/base-share-auth-local.guard';
import { BaseShareAuthGuard } from './guard/base-share-auth.guard';

@Controller('api/share')
export class BaseShareOpenController {
  constructor(
    private readonly baseShareAuthService: BaseShareAuthService,
    private readonly prismaService: PrismaService,
    private readonly baseDuplicateService: BaseDuplicateService,
    private readonly permissionService: PermissionService
  ) {}

  @HttpCode(200)
  @Public()
  @UseGuards(BaseShareAuthLocalGuard)
  @Post('/:shareId/base/auth')
  async auth(
    @Request() req: Express.Request & { shareId: string; password: string },
    @Res({ passthrough: true }) res: Response
  ): Promise<IBaseShareAuthVo> {
    const shareId = req.shareId;
    const password = req.password;
    const token = await this.baseShareAuthService.authToken({ shareId, password });
    res.cookie(shareId, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });
    return { token };
  }

  @Public()
  @UseGuards(BaseShareAuthGuard)
  @AllowAnonymous()
  @Get('/:shareId/base')
  async getBaseShare(
    @Request() req: Express.Request & { baseShareInfo: IBaseShareInfo }
  ): Promise<IGetBaseShareVo> {
    const shareInfo = req.baseShareInfo;
    const { baseId, nodeId, allowSave, allowCopy, allowEdit } = shareInfo;

    // Build default URL for redirect
    const defaultUrl = await this.buildDefaultUrl(baseId, nodeId);

    return {
      baseId,
      shareMeta: {
        password: await this.baseShareAuthService.hasPassword(shareInfo.shareId),
        nodeId,
        allowSave,
        allowCopy,
        allowEdit,
      },
      defaultUrl,
    };
  }

  /**
   * Build the default URL for share redirect.
   * Returns a URL like "/base/xxx/table/yyy/zzz" or "/base/xxx/dashboard/yyy"
   */
  private async buildDefaultUrl(
    baseId: string,
    nodeId: string | null
  ): Promise<string | undefined> {
    // Get all nodes in the base
    const allNodes = await this.prismaService.baseNode.findMany({
      where: { baseId },
      select: {
        id: true,
        parentId: true,
        resourceType: true,
        resourceId: true,
        order: true,
      },
      orderBy: { order: 'asc' },
    });

    if (allNodes.length === 0) {
      return undefined;
    }

    let targetNode: { resourceType: string; resourceId: string } | null = null;

    if (nodeId === null) {
      // Whole base share: find first accessible node from root
      targetNode = this.findFirstAccessibleNode(allNodes, null);
    } else {
      // Find the shared node
      const sharedNode = allNodes.find((n) => n.id === nodeId);
      if (sharedNode) {
        // If the shared node is a folder, find the first accessible non-folder child
        if (sharedNode.resourceType.toLowerCase() === 'folder') {
          targetNode = this.findFirstAccessibleNode(allNodes, nodeId);
        } else {
          targetNode = {
            resourceType: sharedNode.resourceType,
            resourceId: sharedNode.resourceId,
          };
        }
      }
    }

    if (!targetNode) {
      return undefined;
    }

    // Build URL based on resource type
    const resourceType = targetNode.resourceType.toLowerCase();
    const resourceId = targetNode.resourceId;

    switch (resourceType) {
      case 'table':
        return `/base/${baseId}/table/${resourceId}`;
      case 'dashboard':
        return `/base/${baseId}/dashboard/${resourceId}`;
      case 'workflow':
        return `/base/${baseId}/automation/${resourceId}`;
      case 'app':
        return `/base/${baseId}/app/${resourceId}`;
      default:
        return undefined;
    }
  }

  @HttpCode(200)
  @UseGuards(BaseShareAuthGuard, PermissionGuard)
  @Permissions('base|create')
  @ResourceMeta('spaceId', 'body')
  @Post('/:shareId/base/copy')
  async copyBaseShare(
    @Request() req: Express.Request & { baseShareInfo: IBaseShareInfo },
    @Body(new ZodValidationPipe(copyBaseShareRoSchema)) body: ICopyBaseShareRo
  ): Promise<ICopyBaseShareVo> {
    const { baseId: fromBaseId, nodeId, allowSave } = req.baseShareInfo;
    const { spaceId, name, withRecords = true, baseId: targetBaseId } = body;

    // Check if share allows saving
    if (!allowSave) {
      throw new CustomHttpException(
        'This share does not allow copying',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.baseShare.copyNotAllowed',
          },
        }
      );
    }

    // Validate target base if copying into an existing base
    if (targetBaseId) {
      const targetBase = await this.prismaService.base.findFirst({
        where: { id: targetBaseId, deletedTime: null },
        select: { spaceId: true },
      });

      if (!targetBase) {
        throw new CustomHttpException('Target base not found', HttpErrorCode.VALIDATION_ERROR);
      }

      if (targetBase.spaceId !== spaceId) {
        throw new CustomHttpException(
          'Target base does not belong to the specified space',
          HttpErrorCode.VALIDATION_ERROR
        );
      }

      await this.permissionService.validPermissions(targetBaseId, ['base|update']);
    }

    // For whole-base share (nodeId=null), include all root-level nodes
    let nodes: string[];
    if (nodeId === null) {
      const rootNodes = await this.prismaService.baseNode.findMany({
        where: { baseId: fromBaseId, parentId: null },
        select: { id: true },
      });
      nodes = rootNodes.map((n) => n.id);
    } else {
      nodes = [nodeId];
    }

    // Copy the base using BaseDuplicateService
    // allowCrossBase = false to disconnect cross-base links
    // duplicateMode = CopyShareBase to handle node relationships correctly
    const { base, recordsLength } = await this.baseDuplicateService.duplicateBase(
      {
        fromBaseId,
        spaceId,
        name,
        withRecords,
        nodes,
        baseId: targetBaseId,
      },
      false, // allowCrossBase = false
      BaseDuplicateMode.CopyShareBase
    );

    // Emit audit log for share base copy
    await this.baseDuplicateService.emitShareBaseCopyAuditLog(
      base.id,
      req.baseShareInfo.shareId,
      recordsLength
    );

    return {
      id: base.id,
      name: base.name,
      spaceId: base.spaceId,
    };
  }

  /**
   * Find the first accessible non-folder node within a folder hierarchy.
   * Uses depth-first search with order-based sorting.
   * @param parentNodeId - null means find from root level
   */
  private findFirstAccessibleNode(
    allNodes: Array<{
      id: string;
      parentId: string | null;
      resourceType: string;
      resourceId: string;
      order: number;
    }>,
    parentNodeId: string | null
  ): { resourceType: string; resourceId: string } | null {
    const children = allNodes
      .filter((n) => n.parentId === parentNodeId)
      .sort((a, b) => a.order - b.order);

    for (const child of children) {
      if (child.resourceType.toLowerCase() !== 'folder') {
        return { resourceType: child.resourceType, resourceId: child.resourceId };
      }
      const found = this.findFirstAccessibleNode(allNodes, child.id);
      if (found) return found;
    }
    return null;
  }
}
