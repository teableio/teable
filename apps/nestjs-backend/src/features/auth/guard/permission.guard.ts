import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANONYMOUS_USER_ID, IdPrefix, type PermissionAction } from '@teable-group/core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { IResourceMeta } from '../decorators/resource_meta.decorator';
import { RESOURCE_META } from '../decorators/resource_meta.decorator';
import { PermissionService } from '../permission.service';

@Injectable()
export class PermissionGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService
  ) {}

  private getResourceId(context: ExecutionContext): string | undefined {
    const resourceMeta = this.reflector.getAllAndOverride<IResourceMeta | undefined>(
      RESOURCE_META,
      [context.getHandler(), context.getClass()]
    );
    const req = context.switchToHttp().getRequest();

    if (resourceMeta) {
      const { type, position } = resourceMeta;
      return req?.[position]?.[type];
    }
    // before check baseId, as users can be individually invited into the base.
    return req.params.baseId || req.params.spaceId || req.params.tableId;
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }
    const permissions = this.reflector.getAllAndOverride<PermissionAction[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!permissions?.length) {
      return true;
    }
    const req = context.switchToHttp().getRequest();
    const spaceId = req.params.spaceId;
    const baseId = req.params.baseId;
    const tableId = req.params.tableId;
    const resourceId = this.getResourceId(context);
    if (!resourceId) {
      throw new ForbiddenException('permission check ID does not exist');
    }

    let permissionsByCheck: PermissionAction[] = [];
    if (resourceId.startsWith(IdPrefix.Space)) {
      permissionsByCheck = await this.permissionService.checkPermissionBySpaceId(
        spaceId,
        permissions
      );
    } else if (resourceId.startsWith(IdPrefix.Base)) {
      permissionsByCheck = await this.permissionService.checkPermissionByBaseId(
        baseId,
        permissions
      );
    } else if (resourceId.startsWith(IdPrefix.Table)) {
      permissionsByCheck = await this.permissionService.checkPermissionByTableId(
        tableId,
        permissions
      );
    } else {
      throw new ForbiddenException('no check permissions method available');
    }
    this.cls.set('permissions', permissionsByCheck);
    return true;
  }
}
