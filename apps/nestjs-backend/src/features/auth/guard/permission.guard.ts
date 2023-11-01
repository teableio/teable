import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionAction } from '@teable-group/core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PermissionService } from '../permission.service';

@Injectable()
export class PermissionGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService
  ) {}

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
    const spaceId = req.params.spaceId || req.query.spaceId || req.body.spaceId;
    const baseId = req.params.baseId || req.query.baseId || req.body.baseId;
    const tableId = req.params.tableId || req.query.tableId || req.body.baseId;
    let permissionsByCheck: PermissionAction[] = [];
    // before check baseId, as users can be individually invited into the base.
    if (baseId) {
      permissionsByCheck = await this.permissionService.checkPermissionByBaseId(
        baseId,
        permissions
      );
    } else if (spaceId) {
      permissionsByCheck = await this.permissionService.checkPermissionBySpaceId(
        spaceId,
        permissions
      );
    } else if (tableId) {
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
