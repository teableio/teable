import { Injectable, UnauthorizedException } from '@nestjs/common';
import { FieldType, HttpErrorCode } from '@teable/core';
import type { IViewVo, IShareViewMeta, ILinkFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import cookie from 'cookie';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';
import { hashSharePassword } from '../../utils/share-password-hash';
import { AuditScope } from '../audit/audit-scope';
import { TeableJwtService } from '../auth/jwt/teable-jwt.service';
import { PermissionService } from '../auth/permission.service';
import { createFieldInstanceByRaw, type IFieldInstance } from '../field/model/factory';
import { defaultShareMetaMap } from '../view/constant';
import { createViewVoByRaw } from '../view/model/factory';
import { SharedViewAccessV2Service } from './shared-view-access-v2.service';

export interface IShareViewInfo {
  shareId: string;
  tableId: string;
  view?: IViewVo;
  linkOptions?: Pick<ILinkFieldOptions, 'filterByViewId' | 'visibleFieldIds' | 'filter'>;
  shareMeta?: IShareViewMeta;
}

/** What the caller of a link view presents: the page it reads from, and its cookies. */
export interface ILinkViewCaller {
  templateHeader?: string;
  shareViewHeader?: string;
  baseShareHeader?: string;
  cookieHeader?: string;
}

export interface IJwtShareInfo {
  shareId: string;
  // sha256 over shareId + password (see hashSharePassword); never the password.
  pwHash: string;
}

@Injectable()
export class ShareAuthService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly prismaService: PrismaService,
    private readonly jwtService: TeableJwtService,
    private readonly cls: ClsService<IClsStore>,
    private readonly sharedViewAccessV2Service: SharedViewAccessV2Service,
    private readonly audit: AuditScope
  ) {}

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<IJwtShareInfo>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  private async getSharePassword(
    shareId: string,
    useV2: boolean
  ): Promise<{ password: string; shareInfo: IShareViewInfo } | null> {
    const shareInfo = await this.findShareViewInfo(shareId, useV2);
    if (!shareInfo) {
      return null;
    }
    const password = shareInfo.shareMeta?.password;
    if (!password) {
      throw new CustomHttpException(
        'Password restriction is not enabled',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.shareAuth.passwordRestrictionNotEnabled',
          },
        }
      );
    }
    return { password, shareInfo };
  }

  /**
   * The password form of a shared view. Every attempt on a live share is audited, the wrong ones
   * as `share.view.auth-failed` so a guessing run stays visible; `actorId` is the visitor's own
   * session user when they are signed in, else the row goes to 'anonymous'.
   */
  async authShareView(
    shareId: string,
    pass: string,
    useV2 = false,
    actorId?: string
  ): Promise<string | null> {
    const share = await this.getSharePassword(shareId, useV2);
    if (!share) {
      return null;
    }
    const userId = actorId ?? this.cls.get('user.id') ?? 'anonymous';
    const params = {
      shareId,
      tableId: share.shareInfo.tableId,
      viewId: share.shareInfo.view?.id,
    };
    if (pass !== share.password) {
      await this.audit.emitAtomic({
        action: 'share.view.auth-failed',
        resourceId: shareId,
        userId,
        params,
      });
      return null;
    }
    await this.audit.emitAtomic({
      action: 'share.view.auth',
      resourceId: shareId,
      userId,
      params,
    });
    return shareId;
  }

  /** Cookie counterpart of authShareView: compares the hash the cookie carries. */
  async authShareViewByHash(shareId: string, pwHash: string, useV2 = false) {
    const share = await this.getSharePassword(shareId, useV2);
    return share !== null && hashSharePassword(shareId, share.password) === pwHash ? shareId : null;
  }

  async authToken(shareId: string, password: string) {
    const payload: IJwtShareInfo = { shareId, pwHash: hashSharePassword(shareId, password) };
    return await this.jwtService.signAsync(payload);
  }

  async getShareViewInfo(shareId: string, useV2 = false): Promise<IShareViewInfo> {
    const shareInfo = await this.findShareViewInfo(shareId, useV2);
    if (!shareInfo) {
      throw new CustomHttpException('Share view not found', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.shareAuth.shareViewNotFound',
        },
      });
    }
    return shareInfo;
  }

  async getLinkViewInfo(
    linkFieldId: string,
    caller: ILinkViewCaller = {},
    useV2 = false
  ): Promise<IShareViewInfo> {
    if (useV2) {
      const target = await this.sharedViewAccessV2Service.findLinkShareTarget(linkFieldId);
      const baseShareId = await this.authorizeLinkFieldAccess(
        target.hostTableId,
        linkFieldId,
        caller,
        true
      );
      await this.assertBaseShareReaches(baseShareId, target.tableId);
      return {
        shareId: linkFieldId,
        tableId: target.tableId,
        linkOptions: target.linkOptions,
        shareMeta: {
          allowCopy: true,
          includeRecords: true,
        },
      };
    }

    const fieldRaw = await this.prismaService.field
      .findFirstOrThrow({
        where: {
          id: linkFieldId,
          deletedTime: null,
        },
      })
      .catch((_err) => {
        throw new CustomHttpException(
          `Link field ${linkFieldId} not exist`,
          HttpErrorCode.NOT_FOUND,
          {
            localization: {
              i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
            },
          }
        );
      });

    const field = createFieldInstanceByRaw(fieldRaw);
    if (field.type !== FieldType.Link) {
      throw new CustomHttpException(
        'Field is not a link field',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.share.fieldTypeNotLinkField',
          },
        }
      );
    }

    const baseShareId = await this.authorizeLinkFieldAccess(
      fieldRaw.tableId,
      fieldRaw.id,
      caller,
      false
    );

    const { tableId, linkOptions } = await this.resolveLinkShareTarget(field);
    await this.assertBaseShareReaches(baseShareId, tableId);

    return {
      shareId: linkFieldId,
      tableId,
      linkOptions,
      shareMeta: {
        allowCopy: true,
        includeRecords: true,
      },
    };
  }

  /** Resolves to the project share that vouched for the caller, when one did. */
  private async authorizeLinkFieldAccess(
    tableId: string,
    fieldId: string,
    { templateHeader, shareViewHeader, baseShareHeader, cookieHeader }: ILinkViewCaller,
    useV2: boolean
  ): Promise<string | undefined> {
    if (templateHeader) {
      const templateId = this.permissionService.getTemplateIdByHeader(templateHeader);
      if (!templateId) {
        throw new CustomHttpException(
          `Template header is invalid`,
          HttpErrorCode.RESTRICTED_RESOURCE,
          {
            localization: {
              i18nKey: 'httpErrors.permission.templateHeaderInvalid',
            },
          }
        );
      }
    }
    // Authorize the lookup. Four legitimate callers:
    //   1. Template preview pages → templateHeader / cls.template carry the proof
    //   2. Project share pages → X-Tea-Base-Share names a share that covers this
    //      field's parent table
    //   3. Share-view pages → X-Tea-Share-View points at this field's parent
    //      table and the link field is visible in that shared view
    //   4. The caller is a base collaborator with table read access
    const hasTemplateContext = Boolean(templateHeader || this.cls.get('template'));
    if (hasTemplateContext) {
      await this.permissionService.validTemplatePermissions(tableId, [
        'table|read',
        'record|read',
        'field|read',
      ]);
      return undefined;
    }
    const baseShareId = await this.validLinkFieldBaseShareContext(
      tableId,
      baseShareHeader,
      cookieHeader
    );
    if (baseShareId) {
      return baseShareId;
    }
    const hasShareViewContext = await this.validLinkFieldShareViewContext(
      tableId,
      fieldId,
      shareViewHeader,
      cookieHeader,
      useV2
    );
    if (!hasShareViewContext) {
      await this.permissionService.validPermissions(tableId, [
        'table|read',
        'record|read',
        'field|read',
      ]);
    }
    return undefined;
  }

  private async resolveLinkShareTarget(
    field: IFieldInstance,
    visited = new Set<string>()
  ): Promise<{
    tableId: string;
    linkOptions: Pick<ILinkFieldOptions, 'filterByViewId' | 'visibleFieldIds' | 'filter'>;
  }> {
    if (visited.has(field.id)) {
      throw new CustomHttpException(
        `Link field ${field.id} is missing foreignTableId`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
          },
        }
      );
    }
    visited.add(field.id);

    const options = field.options as ILinkFieldOptions | undefined;
    if (options?.foreignTableId) {
      const { filterByViewId, visibleFieldIds, filter } = options;
      return {
        tableId: options.foreignTableId,
        linkOptions: { filterByViewId, visibleFieldIds, filter },
      };
    }

    const lookupFieldId = field.lookupOptions?.lookupFieldId;
    if (field.isLookup && lookupFieldId) {
      const innerRaw = await this.prismaService.field.findFirst({
        where: { id: lookupFieldId, deletedTime: null },
      });
      if (!innerRaw) {
        throw new CustomHttpException(
          `Link field ${lookupFieldId} not exist`,
          HttpErrorCode.NOT_FOUND,
          {
            localization: {
              i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
            },
          }
        );
      }
      const inner = createFieldInstanceByRaw(innerRaw);
      if (inner.type !== FieldType.Link) {
        throw new CustomHttpException(
          'Field is not a link field',
          HttpErrorCode.RESTRICTED_RESOURCE,
          {
            localization: {
              i18nKey: 'httpErrors.share.fieldTypeNotLinkField',
            },
          }
        );
      }
      return this.resolveLinkShareTarget(inner, visited);
    }

    throw new CustomHttpException(
      `Link field ${field.id} is missing foreignTableId`,
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
        },
      }
    );
  }

  /**
   * A project share page shows the field's table, so its visitor reads the field's link view
   * as well, when the share covers that table. The share is the ceiling here as on any route,
   * so a share that does not cover the table refuses, whoever asks.
   */
  private async validLinkFieldBaseShareContext(
    tableId: string,
    baseShareHeader?: string,
    cookieHeader?: string
  ): Promise<string | undefined> {
    const shareId =
      baseShareHeader && this.permissionService.getBaseShareIdByHeader(baseShareHeader);
    if (!shareId) {
      return undefined;
    }
    if (!(await this.permissionService.baseSharePasswordPresented(shareId, cookieHeader))) {
      throw new CustomHttpException('Unauthorized', HttpErrorCode.UNAUTHORIZED_SHARE);
    }
    if (!(await this.permissionService.isTableSharedByBaseShare(shareId, tableId))) {
      throw new CustomHttpException(
        `Table ${tableId} is not accessible via share ${shareId}`,
        HttpErrorCode.RESTRICTED_RESOURCE
      );
    }
    return shareId;
  }

  /**
   * Through a project share a link view reads no further than the share does: the share has to
   * cover the table the field links to as well, as a share of the whole base or of a folder
   * holding both tables does.
   */
  private async assertBaseShareReaches(baseShareId: string | undefined, tableId: string) {
    if (baseShareId) {
      await this.permissionService.validBaseSharePermissions(baseShareId, tableId, [
        'table|read',
        'record|read',
        'field|read',
      ]);
    }
  }

  private async validLinkFieldShareViewContext(
    tableId: string,
    fieldId: string,
    shareViewHeader?: string,
    cookieHeader?: string,
    useV2 = false
  ) {
    if (!shareViewHeader) {
      return false;
    }

    const shareId = this.permissionService.getShareViewIdByHeader(shareViewHeader);
    if (!shareId) {
      return false;
    }

    const shareInfo = await this.findShareViewInfo(shareId, useV2);
    if (!shareInfo || shareInfo.tableId !== tableId || !shareInfo.view) {
      return false;
    }

    const view = shareInfo.view;
    // Where a share carries records by default (every view type but form and plugin),
    // turning them off leaves a share with no record data at all. It then vouches for
    // no link picker either, so the caller needs their own read access.
    if (defaultShareMetaMap[view.type]?.includeRecords && !view.shareMeta?.includeRecords) {
      return false;
    }
    if (view.shareMeta?.password) {
      const token = cookie.parse(cookieHeader ?? '')[shareId];
      const valid = token
        ? await this.permissionService.validateShareViewPasswordToken(shareId, token)
        : false;
      if (!valid) {
        throw new CustomHttpException('Unauthorized', HttpErrorCode.UNAUTHORIZED_SHARE);
      }
    }

    if (!view.shareMeta?.includeHiddenField && !isNotHiddenField(fieldId, view)) {
      throw new CustomHttpException(
        'field is hidden, not allowed',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.share.fieldHiddenNotAllowed',
          },
        }
      );
    }

    return true;
  }

  async findShareViewInfo(shareId: string, useV2: boolean): Promise<IShareViewInfo | undefined> {
    if (useV2) {
      return (await this.sharedViewAccessV2Service.findByShareId(shareId)) ?? undefined;
    }

    const view = await this.prismaService.view.findFirst({
      where: { shareId, enableShare: true, deletedTime: null },
    });
    if (!view) {
      return undefined;
    }

    const viewVo = createViewVoByRaw(view);
    return {
      shareId,
      tableId: view.tableId,
      view: viewVo,
      shareMeta: viewVo.shareMeta,
    };
  }
}
