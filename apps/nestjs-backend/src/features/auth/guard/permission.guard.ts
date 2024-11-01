import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Action } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { IS_DISABLED_PERMISSION } from '../decorators/disabled-permission.decorator';
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

  protected async resourcePermission(resourceId: string | undefined, permissions: Action[]) {
    if (!resourceId) {
      throw new ForbiddenException('permission check ID does not exist');
    }
    const accessTokenId = this.cls.get('accessTokenId');
    const ownPermissions = await this.permissionService.validPermissions(
      resourceId,
      permissions,
      accessTokenId
    );
    this.cls.set('permissions', ownPermissions);
    return true;
  }

  protected async instancePermissionChecker(action: Action) {
    const isAdmin = this.cls.get('user.isAdmin');

    if (!isAdmin) {
      throw new ForbiddenException('User is not an admin');
    }

    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
      const allowConfig = scopes.includes(action);
      if (!allowConfig) {
        throw new ForbiddenException(`Access token does not have ${action} permission`);
      }
    }
    return true;
  }

  protected async permissionCheck(context: ExecutionContext) {
    const permissions = this.reflector.getAllAndOverride<Action[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

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
    // instance permission check
    if (permissions?.includes('instance|update')) {
      return this.instancePermissionChecker('instance|update');
    }
    if (permissions?.includes('instance|read')) {
      return this.instancePermissionChecker('instance|read');
    }
    // space create permission check
    if (permissions?.includes('space|create')) {
      return await this.permissionCreateSpace();
    }
    // resource permission check
    return await this.resourcePermission(this.getResourceId(context), permissions);
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

    // disabled check
    const isDisabledPermission = this.reflector.getAllAndOverride<boolean>(IS_DISABLED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isDisabledPermission) {
      return true;
    }

    return this.permissionCheck(context);
  }
}
