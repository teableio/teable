/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { IBaseRole } from '@teable/core';
import {
  createBaseRoSchema,
  duplicateBaseRoSchema,
  ICreateBaseRo,
  IUpdateBaseRo,
  updateBaseRoSchema,
  IDuplicateBaseRo,
  createBaseFromTemplateRoSchema,
  ICreateBaseFromTemplateRo,
  updateOrderRoSchema,
  IUpdateOrderRo,
  createBaseInvitationLinkRoSchema,
  CreateBaseInvitationLinkRo,
  updateBaseInvitationLinkRoSchema,
  emailBaseInvitationRoSchema,
  updateBaseCollaborateRoSchema,
  EmailBaseInvitationRo,
  UpdateBaseCollaborateRo,
  UpdateBaseInvitationLinkRo,
  CollaboratorType,
  listBaseCollaboratorRoSchema,
  ListBaseCollaboratorRo,
  deleteBaseCollaboratorRoSchema,
  DeleteBaseCollaboratorRo,
  addBaseCollaboratorRoSchema,
  AddBaseCollaboratorRo,
  listBaseCollaboratorUserRoSchema,
  IListBaseCollaboratorUserRo,
  ImportBaseRo,
  importBaseRoSchema,
  moveBaseRoSchema,
  IMoveBaseRo,
} from '@teable/openapi';
import type {
  CreateBaseInvitationLinkVo,
  EmailInvitationVo,
  IBaseErdVo,
  ICreateBaseVo,
  IDbConnectionVo,
  IGetBaseAllVo,
  IGetBasePermissionVo,
  IGetBaseVo,
  IGetSharedBaseVo,
  IImportBaseVo,
  IListBaseCollaboratorUserVo,
  IUpdateBaseVo,
  ListBaseCollaboratorVo,
  ListBaseInvitationLinkVo,
  UpdateBaseInvitationLinkVo,
} from '@teable/openapi';
import { EmitControllerEvent } from '../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../event-emitter/events';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { InvitationService } from '../invitation/invitation.service';
import { BaseExportService } from './base-export.service';
import { BaseImportService } from './base-import.service';
import { BaseQueryService } from './base-query/base-query.service';
import { BaseService } from './base.service';
import { DbConnectionService } from './db-connection.service';

@Controller('api/base/')
export class BaseController {
  constructor(
    private readonly baseService: BaseService,
    private readonly baseExportService: BaseExportService,
    private readonly baseImportService: BaseImportService,
    private readonly dbConnectionService: DbConnectionService,
    private readonly collaboratorService: CollaboratorService,
    private readonly baseQueryService: BaseQueryService,
    private readonly invitationService: InvitationService
  ) {}

  @Post()
  @Permissions('base|create')
  @ResourceMeta('spaceId', 'body')
  @EmitControllerEvent(Events.BASE_CREATE)
  async createBase(
    @Body(new ZodValidationPipe(createBaseRoSchema))
    createBaseRo: ICreateBaseRo
  ) {
    return await this.baseService.createBase(createBaseRo);
  }

  @Post('import')
  @Permissions('base|create')
  @ResourceMeta('spaceId', 'body')
  @EmitControllerEvent(Events.BASE_CREATE)
  async importBase(
    @Body(new ZodValidationPipe(importBaseRoSchema))
    importBaseRo: ImportBaseRo
  ): Promise<IImportBaseVo> {
    return await this.baseImportService.importBase(importBaseRo);
  }

  @Post('duplicate')
  @Permissions('base|create')
  @ResourceMeta('spaceId', 'body')
  @EmitControllerEvent(Events.BASE_CREATE)
  async duplicateBase(
    @Body(new ZodValidationPipe(duplicateBaseRoSchema))
    duplicateBaseRo: IDuplicateBaseRo
  ): Promise<ICreateBaseVo> {
    return await this.baseService.duplicateBase(duplicateBaseRo);
  }

  @Post('create-from-template')
  @Permissions('base|create')
  @ResourceMeta('spaceId', 'body')
  @EmitControllerEvent(Events.BASE_CREATE)
  async createBaseFromTemplate(
    @Body(new ZodValidationPipe(createBaseFromTemplateRoSchema))
    createBaseFromTemplateRo: ICreateBaseFromTemplateRo
  ): Promise<ICreateBaseVo> {
    return await this.baseService.createBaseFromTemplate(createBaseFromTemplateRo);
  }

  @Patch(':baseId')
  @Permissions('base|update')
  @EmitControllerEvent(Events.BASE_UPDATE)
  async updateBase(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(updateBaseRoSchema))
    updateBaseRo: IUpdateBaseRo
  ): Promise<IUpdateBaseVo> {
    return await this.baseService.updateBase(baseId, updateBaseRo);
  }

  @Put(':baseId/order')
  @Permissions('base|update')
  async updateOrder(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(updateOrderRoSchema)) updateOrderRo: IUpdateOrderRo
  ) {
    return await this.baseService.updateOrder(baseId, updateOrderRo);
  }

  @Get('shared-base')
  async getSharedBase(): Promise<IGetSharedBaseVo> {
    return this.collaboratorService.getSharedBase();
  }

  @Permissions('base|read')
  @Get(':baseId')
  async getBaseById(@Param('baseId') baseId: string): Promise<IGetBaseVo> {
    return await this.baseService.getBaseById(baseId);
  }

  @Permissions('base|read_all')
  @Get('access/all')
  async getAllBase(): Promise<IGetBaseAllVo> {
    return this.baseService.getAllBaseList();
  }

  @Delete(':baseId')
  @Permissions('base|delete')
  @EmitControllerEvent(Events.BASE_DELETE)
  async deleteBase(@Param('baseId') baseId: string) {
    return await this.baseService.deleteBase(baseId);
  }

  @Permissions('base|db_connection')
  @Post(':baseId/connection')
  async createDbConnection(@Param('baseId') baseId: string): Promise<IDbConnectionVo | null> {
    return await this.dbConnectionService.create(baseId);
  }

  @Permissions('base|db_connection')
  @Get(':baseId/connection')
  async getDBConnection(@Param('baseId') baseId: string): Promise<IDbConnectionVo | null> {
    return await this.dbConnectionService.retrieve(baseId);
  }

  @Permissions('base|db_connection')
  @Delete(':baseId/connection')
  async deleteDbConnection(@Param('baseId') baseId: string) {
    await this.dbConnectionService.remove(baseId);
    return null;
  }

  @Permissions('base|read')
  @Get(':baseId/collaborators')
  async listCollaborator(
    @Param('baseId') baseId: string,
    @Query(new ZodValidationPipe(listBaseCollaboratorRoSchema)) options: ListBaseCollaboratorRo
  ): Promise<ListBaseCollaboratorVo> {
    return {
      collaborators: await this.collaboratorService.getListByBase(baseId, options),
      total: await this.collaboratorService.getTotalBase(baseId, options),
    };
  }

  @Permissions('base|read')
  @Get(':baseId/permission')
  async getPermission(): Promise<IGetBasePermissionVo> {
    return await this.baseService.getPermission();
  }

  @Permissions('base|invite_link')
  @Post(':baseId/invitation/link')
  async createInvitationLink(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createBaseInvitationLinkRoSchema))
    baseInvitationLinkRo: CreateBaseInvitationLinkRo
  ): Promise<CreateBaseInvitationLinkVo> {
    const res = await this.invitationService.generateInvitationLink({
      resourceId: baseId,
      resourceType: CollaboratorType.Base,
      role: baseInvitationLinkRo.role,
    });
    return {
      ...res,
      role: res.role as IBaseRole,
    };
  }

  @Permissions('base|invite_link')
  @Delete(':baseId/invitation/link/:invitationId')
  async deleteInvitationLink(
    @Param('baseId') baseId: string,
    @Param('invitationId') invitationId: string
  ): Promise<void> {
    return this.invitationService.deleteInvitationLink({
      resourceId: baseId,
      resourceType: CollaboratorType.Base,
      invitationId,
    });
  }

  @Permissions('base|invite_link')
  @Patch(':baseId/invitation/link/:invitationId')
  async updateInvitationLink(
    @Param('baseId') baseId: string,
    @Param('invitationId') invitationId: string,
    @Body(new ZodValidationPipe(updateBaseInvitationLinkRoSchema))
    updateSpaceInvitationLinkRo: UpdateBaseInvitationLinkRo
  ): Promise<UpdateBaseInvitationLinkVo> {
    const res = await this.invitationService.updateInvitationLink({
      resourceId: baseId,
      resourceType: CollaboratorType.Base,
      invitationId,
      role: updateSpaceInvitationLinkRo.role,
    });

    return {
      ...res,
      role: res.role as IBaseRole,
    };
  }

  @Permissions('base|invite_link')
  @Get(':baseId/invitation/link')
  async listInvitationLink(@Param('baseId') baseId: string): Promise<ListBaseInvitationLinkVo> {
    const res = this.invitationService.getInvitationLink(baseId, CollaboratorType.Base);
    return res as unknown as ListBaseInvitationLinkVo;
  }

  @Permissions('base|invite_email')
  @Post(':baseId/invitation/email')
  async emailInvitation(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(emailBaseInvitationRoSchema))
    emailBaseInvitationRo: EmailBaseInvitationRo
  ): Promise<EmailInvitationVo> {
    return this.invitationService.emailInvitationByBase(baseId, emailBaseInvitationRo);
  }

  @Patch(':baseId/collaborators')
  async updateCollaborator(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(updateBaseCollaborateRoSchema))
    updateBaseCollaborateRo: UpdateBaseCollaborateRo
  ): Promise<void> {
    await this.collaboratorService.updateCollaborator({
      resourceId: baseId,
      resourceType: CollaboratorType.Base,
      ...updateBaseCollaborateRo,
    });
  }

  @Delete(':baseId/collaborators')
  async deleteCollaborator(
    @Param('baseId') baseId: string,
    @Query(new ZodValidationPipe(deleteBaseCollaboratorRoSchema))
    deleteBaseCollaboratorRo: DeleteBaseCollaboratorRo
  ): Promise<void> {
    await this.collaboratorService.deleteCollaborator({
      resourceId: baseId,
      resourceType: CollaboratorType.Base,
      ...deleteBaseCollaboratorRo,
    });
  }

  @Delete(':baseId/permanent')
  async permanentDeleteBase(@Param('baseId') baseId: string) {
    return await this.baseService.permanentDeleteBase(baseId);
  }

  @Post(':baseId/collaborator')
  async addCollaborators(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(addBaseCollaboratorRoSchema))
    addBaseCollaboratorRo: AddBaseCollaboratorRo
  ) {
    return await this.collaboratorService.addBaseCollaborators(baseId, addBaseCollaboratorRo);
  }

  @Permissions('base|read')
  @Get(':baseId/collaborators/users')
  async getUserCollaborators(
    @Param('baseId') baseId: string,
    @Query(new ZodValidationPipe(listBaseCollaboratorUserRoSchema))
    listBaseCollaboratorUserRo: IListBaseCollaboratorUserRo
  ): Promise<IListBaseCollaboratorUserVo> {
    return {
      users: await this.collaboratorService.getUserCollaborators(
        baseId,
        listBaseCollaboratorUserRo
      ),
      total: await this.collaboratorService.getUserCollaboratorsTotal(
        baseId,
        listBaseCollaboratorUserRo
      ),
    };
  }

  @Permissions('base|read')
  @Get(':baseId/export')
  async exportBase(@Param('baseId') baseId: string) {
    return await this.baseExportService.exportBaseZip(baseId);
  }

  @Put(':baseId/move')
  @Permissions('space|update')
  async moveBase(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(moveBaseRoSchema)) moveBaseRo: IMoveBaseRo
  ) {
    await this.baseService.moveBase(baseId, moveBaseRo);
  }

  @Permissions('base|update')
  @Get(':baseId/erd')
  async generateBaseErd(@Param('baseId') baseId: string): Promise<IBaseErdVo> {
    return await this.baseService.generateBaseErd(baseId);
  }
}
