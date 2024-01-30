import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdPrefix, type PermissionAction } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { IResourceMeta } from '../decorators/resource_meta.decorator';
import { RESOURCE_META } from '../decorators/resource_meta.decorator';
import { IS_TOKEN_ACCESS } from '../decorators/token.decorator';
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

  /**
   * Space creation permissions are more specific and only pertain to users,
   * but tokens can be disallowed from being created.
   */
  private async permissionCreateSpace() {
    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
      return scopes.includes('space|create');
    }
    return true;
  }

  private async resourcePermission(context: ExecutionContext, permissions: PermissionAction[]) {
    const resourceId = this.getResourceId(context);
    if (!resourceId) {
      throw new ForbiddenException('permission check ID does not exist');
    }
    let permissionsByCheck: PermissionAction[] = [];
    if (resourceId.startsWith(IdPrefix.Space)) {
      permissionsByCheck = await this.permissionService.checkPermissionBySpaceId(
        resourceId,
        permissions
      );
    } else if (resourceId.startsWith(IdPrefix.Base)) {
      permissionsByCheck = await this.permissionService.checkPermissionByBaseId(
        resourceId,
        permissions
      );
    } else if (resourceId.startsWith(IdPrefix.Table)) {
      permissionsByCheck = await this.permissionService.checkPermissionByTableId(
        resourceId,
        permissions
      );
    } else {
      throw new ForbiddenException('no check permissions method available');
    }

    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      permissionsByCheck = await this.permissionService.checkPermissionByAccessToken(
        resourceId,
        accessTokenId,
        permissions
      );
    }
    this.cls.set('permissions', permissionsByCheck);
    return true;
  }

  /**
   * permission step:
   * 1. public decorator sign
   *    full public interface
   * 2. token decorator sign
   *    The token can only access interfaces that are restricted by permissions or have a token access indicator.
   * 3. permissions decorator sign
   *    Decorate what permissions are needed to operate the interface,
   *    if none then it means just logging in is sufficient
   * 4. space create permission check
   *    The space create permission is special, it has nothing to do with resources, but only with users.
   * 5. resource permission check
   *    Because the token is user-generated, the permissions will only be less than the current user,
   *    so first determine the current user permissions
   *    5.1. by user for space
   *    5.2. by access token if exists
   */
  async canActivate(context: ExecutionContext) {
    // public check
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

    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId && !permissions?.length) {
      // Pre-checking of tokens
      // The token can only access interfaces that are restricted by permissions or have a token access indicator.
      return this.reflector.getAllAndOverride<boolean>(IS_TOKEN_ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]);
    }

    if (!permissions?.length) {
      return true;
    }
    // space create permission check
    if (permissions?.includes('space|create')) {
      return await this.permissionCreateSpace();
    }
    // resource permission check
    return await this.resourcePermission(context, permissions);
  }
}
