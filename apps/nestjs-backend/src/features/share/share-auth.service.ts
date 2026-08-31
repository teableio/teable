import { Injectable, UnauthorizedException } from '@nestjs/common';
import { FieldType, HttpErrorCode } from '@teable/core';
import type { IViewVo, IShareViewMeta, ILinkFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import cookie from 'cookie';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';
import { TeableJwtService } from '../auth/jwt/teable-jwt.service';
import { PermissionService } from '../auth/permission.service';
import { createFieldInstanceByRaw, type IFieldInstance } from '../field/model/factory';
import { createViewVoByRaw } from '../view/model/factory';
import { SharedViewAccessV2Service } from './shared-view-access-v2.service';

export interface IShareViewInfo {
  shareId: string;
  tableId: string;
  view?: IViewVo;
  linkOptions?: Pick<ILinkFieldOptions, 'filterByViewId' | 'visibleFieldIds' | 'filter'>;
  shareMeta?: IShareViewMeta;
}

export interface IJwtShareInfo {
  shareId: string;
  password: string;
}

@Injectable()
export class ShareAuthService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly prismaService: PrismaService,
    private readonly jwtService: TeableJwtService,
    private readonly cls: ClsService<IClsStore>,
    private readonly sharedViewAccessV2Service: SharedViewAccessV2Service
  ) {}

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<IJwtShareInfo>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  async authShareView(shareId: string, pass: string, useV2 = false): Promise<string | null> {
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
    return pass === password ? shareId : null;
  }

  async authToken(jwtShareInfo: IJwtShareInfo) {
    return await this.jwtService.signAsync(jwtShareInfo);
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
    templateHeader?: string,
    shareViewHeader?: string,
    cookieHeader?: string,
    useV2 = false
  ): Promise<IShareViewInfo> {
    if (useV2) {
      const target = await this.sharedViewAccessV2Service.findLinkShareTarget(linkFieldId);
      await this.authorizeLinkFieldAccess(
        target.hostTableId,
        linkFieldId,
        templateHeader,
        shareViewHeader,
        cookieHeader,
        true
      );
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

    await this.authorizeLinkFieldAccess(
      fieldRaw.tableId,
      fieldRaw.id,
      templateHeader,
      shareViewHeader,
      cookieHeader,
      false
    );

    const { tableId, linkOptions } = await this.resolveLinkShareTarget(field);

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

  private async authorizeLinkFieldAccess(
    tableId: string,
    fieldId: string,
    templateHeader: string | undefined,
    shareViewHeader: string | undefined,
    cookieHeader: string | undefined,
    useV2: boolean
  ) {
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
    // Authorize the lookup. Three legitimate callers:
    //   1. Template preview pages → templateHeader / cls.template carry the proof
    //   2. Share-view pages → X-Tea-Share-View points at this field's parent
    //      table and the link field is visible in that shared view
    //   3. The caller is a base collaborator with table read access
    const hasTemplateContext = Boolean(templateHeader || this.cls.get('template'));
    if (hasTemplateContext) {
      await this.permissionService.validTemplatePermissions(tableId, [
        'table|read',
        'record|read',
        'field|read',
      ]);
      return;
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

  private async findShareViewInfo(
    shareId: string,
    useV2: boolean
  ): Promise<IShareViewInfo | undefined> {
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
