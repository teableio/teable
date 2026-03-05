import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANONYMOUS_USER_ID, HttpErrorCode, isAnonymous, type Action } from '@teable/core';
import cookie from 'cookie';
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
import { getTemplateHeader, getBaseShareHeader } from '../utils';

const i18nKeyCheckIdNotExist = 'httpErrors.permission.checkIdNotExist';

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

  private async permissionUserIntegrations() {
    const accessTokenId = this.cls.get('accessTokenId');
    if (accessTokenId) {
      const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
      return scopes.includes('user|integrations');
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
            i18nKey: i18nKeyCheckIdNotExist,
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

  protected async baseSharePermissionCheck(context: ExecutionContext, shareId: string) {
    await this.ensureBaseShareAuth(context, shareId);
    const resourceId = this.getResourceId(context) || this.defaultResourceId(context);
    if (!resourceId) {
      throw new CustomHttpException(
        `Base share permission check ID does not exist`,
        this.isAnonymous() ? HttpErrorCode.UNAUTHORIZED : HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: i18nKeyCheckIdNotExist,
          },
        }
      );
    }
    const permissions = this.reflector.getAllAndOverride<Action[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permissions?.length) {
      throw new ForbiddenException('Base share permissions are required');
    }
    const ownPermissions = await this.permissionService.validBaseSharePermissions(
      shareId,
      resourceId,
      permissions
    );
    // Set user to anonymous for share context
    this.cls.set('user', {
      id: ANONYMOUS_USER_ID,
      name: ANONYMOUS_USER_ID,
      email: '',
    });
    this.cls.set('permissions', ownPermissions);
    return true;
  }

  private async ensureBaseShareAuth(context: ExecutionContext, shareId: string) {
    const requirePassword = await this.permissionService.baseShareRequiresPassword(shareId);
    if (!requirePassword) {
      return;
    }
    const req = context.switchToHttp().getRequest();
    const cookies = cookie.parse(req.headers.cookie ?? '');
    const token = cookies[shareId];
    if (!token) {
      throw new CustomHttpException('Unauthorized', HttpErrorCode.UNAUTHORIZED_SHARE);
    }
    const valid = await this.permissionService.validateBaseSharePasswordToken(shareId, token);
    if (!valid) {
      throw new CustomHttpException('Unauthorized', HttpErrorCode.UNAUTHORIZED_SHARE);
    }
  }

  private async resourcePermission(resourceId: string | undefined, permissions: Action[]) {
    if (!resourceId) {
      throw new CustomHttpException(
        `Permission check ID does not exist`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: i18nKeyCheckIdNotExist,
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

    if (permissions?.includes('user|integrations')) {
      return await this.permissionUserIntegrations();
    }

    // resource permission check
    return await this.resourcePermission(resourceId, permissions);
  }

  private isAnonymous() {
    return isAnonymous(this.cls.get('user.id'));
  }

  /**
   * Try to perform base share permission check if shareId can be extracted from header.
   * @returns true if check passed, undefined if no valid shareId found in header
   */
  private async tryBaseSharePermissionCheck(
    context: ExecutionContext,
    baseShareHeader: string | undefined
  ): Promise<boolean | undefined> {
    if (!baseShareHeader) {
      return undefined;
    }
    const shareId = this.permissionService.getBaseShareIdByHeader(baseShareHeader);
    if (!shareId) {
      return undefined;
    }
    return await this.baseSharePermissionCheck(context, shareId);
  }

  /**
   * Resolve RESOURCE-level permission using resource-specific auth (base share > template).
   * @returns true if resolved, undefined if no valid auth header found
   */
  private async resolveResourcePermission(
    context: ExecutionContext,
    baseShareHeader: string | undefined,
    templateHeader: string | undefined
  ): Promise<boolean | undefined> {
    if (baseShareHeader) {
      const result = await this.tryBaseSharePermissionCheck(context, baseShareHeader);
      if (result !== undefined) return result;
    }
    if (templateHeader) {
      return this.templatePermissionCheck(context, templateHeader);
    }
    return undefined;
  }

  /**
   * Resolve permission for anonymous users.
   * Falls back to template check or allows USER-level anonymous access.
   */
  private async resolveAnonymousPermission(
    context: ExecutionContext,
    allowAnonymousType: AllowAnonymousType | undefined
  ): Promise<boolean> {
    if (allowAnonymousType === AllowAnonymousType.PUBLIC) {
      return this.templatePermissionCheck(context);
    }
    if (allowAnonymousType === AllowAnonymousType.USER) {
      return true;
    }
    throw new UnauthorizedException();
  }

  /**
   * Fallback permission check for PUBLIC endpoints when normal check fails.
   * Tries base share first, then template, re-throws original error if all fail.
   */
  private async resolvePublicFallback(
    context: ExecutionContext,
    baseShareHeader: string | undefined,
    originalError: unknown
  ): Promise<boolean> {
    const baseShareResult = await this.tryBaseShareFallback(context, baseShareHeader);
    if (baseShareResult !== undefined) return baseShareResult;

    this.logger.log('Fallback to template permission check');
    try {
      return await this.templatePermissionCheck(context);
    } catch (e: unknown) {
      const error = e as Error;
      this.logger.error(`Template fallback failed: ${error.message}`, error.stack);
      throw originalError;
    }
  }

  /**
   * Try base share as a fallback, swallowing errors (returns undefined on failure).
   */
  private async tryBaseShareFallback(
    context: ExecutionContext,
    baseShareHeader: string | undefined
  ): Promise<boolean | undefined> {
    if (!baseShareHeader) return undefined;
    const shareId = this.permissionService.getBaseShareIdByHeader(baseShareHeader);
    if (!shareId) return undefined;

    this.logger.log('Fallback to base share permission check');
    try {
      return await this.baseSharePermissionCheck(context, shareId);
    } catch (e) {
      this.logger.error(`Base share fallback failed: ${e}`);
      return undefined;
    }
  }

  /**
   * Permission check with public/share/template fallback.
   *
   * Priority flow:
   *   1. RESOURCE-level: exclusively use resource-specific auth (base share > template)
   *   2. Early base share check for PUBLIC or anonymous requests when header is present
   *   3. Anonymous user handling (template / USER-level)
   *   4. Authenticated user: standard check, with fallback for PUBLIC endpoints
   */
  protected async permissionCheckWithPublicFallback(
    context: ExecutionContext,
    permissionCheck: () => Promise<boolean>
  ) {
    const req = context.switchToHttp().getRequest();
    const templateHeader = getTemplateHeader(req);
    const baseShareHeader = getBaseShareHeader(req);
    const allowAnonymousType = this.reflector.getAllAndOverride<AllowAnonymousType | undefined>(
      IS_ALLOW_ANONYMOUS,
      [context.getHandler(), context.getClass()]
    );

    // 1. RESOURCE-level: exclusively use resource-specific auth (base share > template)
    if (allowAnonymousType === AllowAnonymousType.RESOURCE) {
      const result = await this.resolveResourcePermission(context, baseShareHeader, templateHeader);
      if (result !== undefined) return result;
      // No valid resource auth header — fall through to normal checks
    }

    // 2. Early base share check for PUBLIC or anonymous requests
    const shouldTryBaseShareEarly =
      baseShareHeader && (allowAnonymousType === AllowAnonymousType.PUBLIC || this.isAnonymous());
    if (shouldTryBaseShareEarly) {
      const result = await this.tryBaseSharePermissionCheck(context, baseShareHeader);
      if (result !== undefined) return result;
    }

    // 3. Anonymous user handling
    if (this.isAnonymous()) {
      return this.resolveAnonymousPermission(context, allowAnonymousType);
    }

    // 4. Authenticated user: standard check, with fallback for PUBLIC endpoints
    try {
      return await permissionCheck();
    } catch (error) {
      if (allowAnonymousType !== AllowAnonymousType.PUBLIC) throw error;
      return this.resolvePublicFallback(context, baseShareHeader, error);
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
