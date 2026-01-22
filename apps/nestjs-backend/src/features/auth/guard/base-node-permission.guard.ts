import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { BaseNodeResourceType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import {
  checkBaseNodePermission,
  checkBaseNodePermissionCreate,
} from '../../base-node/base-node.permission.helper';
import type { IBaseNodePermissionContext } from '../../base-node/types';
import { BaseNodeAction } from '../../base-node/types';
import { BASE_NODE_PERMISSIONS_KEY } from '../decorators/base-node-permissions.decorator';
import { IS_DISABLED_PERMISSION } from '../decorators/disabled-permission.decorator';
import { PermissionService } from '../permission.service';
import { PermissionGuard } from './permission.guard';

@Injectable()
export class BaseNodePermissionGuard extends PermissionGuard {
  constructor(
    private readonly reflectorInner: Reflector,
    private readonly clsInner: ClsService<IClsStore>,
    private readonly permissionServiceInner: PermissionService,
    private readonly prismaService: PrismaService
  ) {
    super(reflectorInner, clsInner, permissionServiceInner);
  }

  async canActivate(context: ExecutionContext) {
    const superResult = await super.canActivate(context);
    if (!superResult) {
      return false;
    }

    // disabled check
    const isDisabledPermission = this.reflectorInner.getAllAndOverride<boolean>(
      IS_DISABLED_PERMISSION,
      [context.getHandler(), context.getClass()]
    );

    if (isDisabledPermission) {
      return true;
    }

    const baseId = this.getBaseId(context);
    if (!baseId) {
      throw new CustomHttpException('Base ID is required', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.baseNode.baseIdIsRequired',
        },
      });
    }
    const permissionContext = await this.getPermissionContext();
    return this.checkActivate(context, baseId, permissionContext);
  }

  async checkActivate(
    context: ExecutionContext,
    baseId: string,
    permissionContext: IBaseNodePermissionContext
  ) {
    const baseNodePermissions = this.reflectorInner.getAllAndOverride<BaseNodeAction[] | undefined>(
      BASE_NODE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!baseNodePermissions?.length) {
      return true;
    }
    const nodeId = this.getNodeId(context);
    const node = await this.getNode(baseId, nodeId);
    const checkCreate = checkBaseNodePermissionCreate(
      node ?? { resourceType: this.getNodeResourceType(context), resourceId: '' },
      baseNodePermissions,
      permissionContext
    );

    if (!checkCreate) {
      return false;
    }

    const baseNodePermissionsWithoutCreate = baseNodePermissions.filter(
      (permission: BaseNodeAction) => permission !== BaseNodeAction.Create
    );
    if (!baseNodePermissionsWithoutCreate.length) {
      return true;
    }

    if (!nodeId) {
      throw new CustomHttpException('Node ID is required', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.baseNode.nodeIdIsRequired',
        },
      });
    }

    if (!node) {
      throw new CustomHttpException('Node not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.baseNode.notFound',
        },
      });
    }

    return baseNodePermissionsWithoutCreate.every((permission: BaseNodeAction) =>
      checkBaseNodePermission(node, permission, permissionContext)
    );
  }

  getBaseId(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest();
    const defaultBaseId = request.params ?? {};
    return super.getResourceId(context) || defaultBaseId.baseId;
  }

  getNodeId(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();
    return req.params.nodeId;
  }

  getNodeResourceType(context: ExecutionContext): BaseNodeResourceType {
    const req = context.switchToHttp().getRequest();
    return req.body.resourceType;
  }

  async getNode(baseId: string, nodeId?: string) {
    if (!nodeId) {
      return;
    }
    const node = await this.prismaService.baseNode.findFirst({
      where: { baseId, id: nodeId },
      select: {
        id: true,
        resourceType: true,
        resourceId: true,
      },
    });

    if (node) {
      return {
        resourceType: node.resourceType as BaseNodeResourceType,
        resourceId: node.resourceId,
      };
    }
  }

  private async getPermissionContext() {
    const permissions = this.clsInner.get('permissions');
    const permissionSet = new Set(permissions);
    return { permissionSet };
  }
}
