import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
  Request,
  UseInterceptors,
} from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  BaseDuplicateMode,
  CreateRecordAction,
  copyBaseShareRoSchema,
  ICopyBaseShareRo,
  type IGetBaseShareVo,
  type IBaseShareAuthVo,
  type ICopyBaseShareVo,
} from '@teable/openapi';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import { AllowAnonymous } from '../auth/decorators/allow-anonymous.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { PermissionService } from '../auth/permission.service';
import { BaseDuplicateV2Service } from '../base/base-duplicate-v2.service';
import { BaseDuplicateService } from '../base/base-duplicate.service';
import { UseV2Feature } from '../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../canary/interceptors/v2-indicator.interceptor';
import type { IBaseShareInfo } from './base-share-auth.service';
import { BaseShareAuthService } from './base-share-auth.service';
import { buildBaseShareDefaultUrl } from './base-share-default-url.helper';
import { BaseShareAuthLocalGuard } from './guard/base-share-auth-local.guard';
import { BaseShareAuthGuard } from './guard/base-share-auth.guard';

@Controller('api/share')
export class BaseShareOpenController {
  constructor(
    private readonly baseShareAuthService: BaseShareAuthService,
    private readonly prismaService: PrismaService,
    private readonly baseDuplicateService: BaseDuplicateService,
    private readonly baseDuplicateV2Service: BaseDuplicateV2Service,
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService<IClsStore>,
    private readonly audit: AuditScope,
    private readonly eventEmitterService: EventEmitterService
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
    const defaultUrl = await buildBaseShareDefaultUrl(this.prismaService, baseId, nodeId);

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

  @HttpCode(200)
  @UseV2Feature('duplicateBase')
  @UseGuards(BaseShareAuthGuard, V2FeatureGuard, PermissionGuard)
  @UseInterceptors(V2IndicatorInterceptor)
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

    // allowCrossBase = false to disconnect cross-base links
    // duplicateMode = CopyShareBase to handle node relationships correctly
    return this.runShareBaseCopy(
      req.baseShareInfo.shareId,
      fromBaseId,
      spaceId,
      name,
      withRecords,
      nodes,
      targetBaseId
    );
  }

  @Audit({
    rootAction: CreateRecordAction.ShareBaseCopy,
    resourceId: (
      _shareId: string,
      fromBaseId: string,
      _spaceId: string,
      _name: string | undefined,
      _withRecords: boolean,
      _nodes: string[],
      targetBaseId: string | undefined
    ) => targetBaseId ?? fromBaseId,
    params: (shareId: string) => ({ shareId }),
  })
  private async runShareBaseCopy(
    shareId: string,
    fromBaseId: string,
    spaceId: string,
    name: string | undefined,
    withRecords: boolean,
    nodes: string[],
    targetBaseId: string | undefined
  ): Promise<ICopyBaseShareVo> {
    const duplicateRo = {
      fromBaseId,
      spaceId,
      name,
      withRecords,
      nodes,
      baseId: targetBaseId,
    };
    const { base } = this.cls.get('useV2')
      ? await this.baseDuplicateV2Service.duplicateBase(
          duplicateRo,
          false,
          BaseDuplicateMode.CopyShareBase
        )
      : await this.baseDuplicateService.duplicateBase(
          duplicateRo,
          false,
          BaseDuplicateMode.CopyShareBase
        );
    // Audit rows emitted by atomic events inside baseDuplicateService.duplicateBase.
    // Terminal signal: operation scope closed. Per-row audit emits inside duplicateBase are
    // fire-and-forget; subscribers needing all audit rows in DB should briefly poll.
    await this.eventEmitterService.emit(Events.BASE_SHARE_COPY_COMPLETE, {
      baseId: base.id,
      fromBaseId,
      shareId,
    });
    return {
      id: base.id,
      name: base.name,
      spaceId: base.spaceId,
    };
  }
}
