import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpErrorCode, isAnonymous, type Action } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { AllowAnonymousType, IS_ALLOW_ANONYMOUS } from '../decorators/allow-anonymous.decorator';
import { IS_DISABLED_PERMISSION } from '../decorators/disabled-permission.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { IResourceMeta } from '../decorators/resource_meta.decorator';
import { RESOURCE_META } from '../decorators/resource_meta.decorator';
import { IS_TOKEN_ACCESS } from '../decorators/token.decorator';
import { PermissionService } from '../permission.service';
import { getTemplateHeader } from '../utils';

@Injectable()
export class PermissionGuard {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService
  ) {}

  protected defaultResourceId(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();
    // before check baseId, as users can be individually invited into the base.
    return req.params.baseId || req.params.spaceId || req.params.tableId;
  }

  protected getResourceId(context: ExecutionContext): string | undefined {
    const resourceMeta = this.reflector.getAllAndOverride<IResourceMeta | undefined>(
      RESOURCE_META,
      [context.getHandler(), context.getClass()]
    );
    const req = context.switchToHttp().getRequest();

    if (resourceMeta) {
      const { type, position } = resourceMeta;
      return req?.[position]?.[type];
    }
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

  private async permissionBaseReadAll() {
    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
      return scopes.includes('base|read_all');
    }
    return true;
  }

  private async permissionSpaceRead() {
    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
      return scopes.includes('space|read');
    }
    return true;
  }

  protected async templatePermissionCheck(context: ExecutionContext, templateHeader?: string) {
    if (templateHeader) {
      const templateId = this.permissionService.getTemplateIdByHeader(templateHeader);
      if (!templateId) {
        throw new CustomHttpException(
          `Template header is invalid`,
          this.isAnonymous() ? HttpErrorCode.UNAUTHORIZED : HttpErrorCode.RESTRICTED_RESOURCE,
          {
            localization: {
              i18nKey: 'httpErrors.permission.templateHeaderInvalid',
            },
          }
        );
      }
    }
    const resourceId = this.getResourceId(context) || this.defaultResourceId(context);
    if (!resourceId) {
      throw new CustomHttpException(
        `Template permission check ID does not exist`,
        this.isAnonymous() ? HttpErrorCode.UNAUTHORIZED : HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.permission.checkIdNotExist',
          },
        }
      );
    }
    const permissions = this.reflector.getAllAndOverride<Action[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permissions?.length) {
      throw new ForbiddenException('Template permissions are required');
    }
    const ownPermissions = await this.permissionService.validTemplatePermissions(
      resourceId,
      permissions
    );
    this.cls.set('permissions', ownPermissions);
    return true;
  }

  private async resourcePermission(resourceId: string | undefined, permissions: Action[]) {
    if (!resourceId) {
      throw new CustomHttpException(
        `Permission check ID does not exist`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.permission.checkIdNotExist',
          },
        }
      );
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
      throw new CustomHttpException(`User is not an admin`, HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.permission.userNotAdmin',
        },
      });
    }

    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
      const allowConfig = scopes.includes(action);
      if (!allowConfig) {
        throw new CustomHttpException(
          `Access token does not have ${action} permission`,
          HttpErrorCode.RESTRICTED_RESOURCE,
          {
            localization: {
              i18nKey: 'httpErrors.permission.accessTokenNoPermission',
            },
          }
        );
      }
    }
    return true;
  }

  protected async permissionCheck(context: ExecutionContext) {
    const permissions = this.reflector.getAllAndOverride<Action[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const resourceId = this.getResourceId(context) || this.defaultResourceId(context);
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
    if (permissions?.includes('space|create')) {
      return await this.permissionCreateSpace();
    }
    if (permissions?.includes('base|read_all')) {
      return await this.permissionBaseReadAll();
    }
    if (!resourceId && permissions?.includes('space|read')) {
      return await this.permissionSpaceRead();
    }

    // resource permission check
    return await this.resourcePermission(resourceId, permissions);
  }

  private isAnonymous() {
    return isAnonymous(this.cls.get('user.id'));
  }

  protected async permissionCheckWithPublicFallback(
    context: ExecutionContext,
    permissionCheck: () => Promise<boolean>
  ) {
    const templateHeader = getTemplateHeader(context.switchToHttp().getRequest());
    const allowAnonymousType = this.reflector.getAllAndOverride<AllowAnonymousType | undefined>(
      IS_ALLOW_ANONYMOUS,
      [context.getHandler(), context.getClass()]
    );
    // anonymous resource permission check
    if (templateHeader && allowAnonymousType === AllowAnonymousType.RESOURCE) {
      return await this.templatePermissionCheck(context, templateHeader);
    }
    const isAnonymous = this.isAnonymous();
    // anonymous user permission check
    if (isAnonymous) {
      if (allowAnonymousType === AllowAnonymousType.PUBLIC) {
        return await this.templatePermissionCheck(context);
      }
      if (allowAnonymousType === AllowAnonymousType.USER) {
        return true;
      }
      throw new UnauthorizedException();
    }

    // normal permission check
    try {
      return await permissionCheck();
    } catch (normalError) {
      // if not public type, not fallback to template permission check, throw normal error
      if (allowAnonymousType !== AllowAnonymousType.PUBLIC) {
        throw normalError;
      }
      this.logger.log('Fallback to template permission check');
      try {
        return await this.templatePermissionCheck(context);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (templateError: any) {
        this.logger.error(
          `Template permission check failed: ${templateError.message}`,
          templateError.stack
        );
        throw normalError;
      }
    }
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

    return await this.permissionCheckWithPublicFallback(context, async () => {
      return await this.permissionCheck(context);
    });
  }
}
