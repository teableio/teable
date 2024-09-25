/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Get,
  Delete,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '@teable/core';
import type {
  ICreateSpaceVo,
  IUpdateSpaceVo,
  IGetSpaceVo,
  EmailInvitationVo,
  ListSpaceInvitationLinkVo,
  CreateSpaceInvitationLinkVo,
  UpdateSpaceInvitationLinkVo,
  ListSpaceCollaboratorVo,
  IGetBaseAllVo,
} from '@teable/openapi';
import {
  createSpaceRoSchema,
  ICreateSpaceRo,
  updateSpaceRoSchema,
  IUpdateSpaceRo,
  emailSpaceInvitationRoSchema,
  updateSpaceInvitationLinkRoSchema,
  CreateSpaceInvitationLinkRo,
  EmailSpaceInvitationRo,
  UpdateSpaceInvitationLinkRo,
  createSpaceInvitationLinkRoSchema,
  updateSpaceCollaborateRoSchema,
  UpdateSpaceCollaborateRo,
  CollaboratorType,
} from '@teable/openapi';
import { EmitControllerEvent } from '../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../event-emitter/events';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { InvitationService } from '../invitation/invitation.service';
import { SpaceService } from './space.service';

@Controller('api/space/')
export class SpaceController {
  constructor(
    private readonly spaceService: SpaceService,
    private readonly invitationService: InvitationService,
    private readonly collaboratorService: CollaboratorService
  ) {}

  @Post()
  @Permissions('space|create')
  @EmitControllerEvent(Events.SPACE_CREATE)
  async createSpace(
    @Body(new ZodValidationPipe(createSpaceRoSchema))
    createSpaceRo: ICreateSpaceRo
  ): Promise<ICreateSpaceVo> {
    return await this.spaceService.createSpace(createSpaceRo);
  }

  @Permissions('space|update')
  @Patch(':spaceId')
  @EmitControllerEvent(Events.SPACE_UPDATE)
  async updateSpace(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(updateSpaceRoSchema))
    updateSpaceRo: IUpdateSpaceRo
  ): Promise<IUpdateSpaceVo> {
    return await this.spaceService.updateSpace(spaceId, updateSpaceRo);
  }

  @Permissions('space|read')
  @Get(':spaceId')
  async getSpaceById(@Param('spaceId') spaceId: string): Promise<IGetSpaceVo> {
    return await this.spaceService.getSpaceById(spaceId);
  }

  @Get()
  async getSpaceList(): Promise<IGetSpaceVo[]> {
    return await this.spaceService.getSpaceList();
  }

  @Permissions('space|delete')
  @Delete(':spaceId')
  @EmitControllerEvent(Events.SPACE_DELETE)
  async deleteSpace(@Param('spaceId') spaceId: string) {
    await this.spaceService.deleteSpace(spaceId);
    return null;
  }

  @Permissions('space|invite_link')
  @Post(':spaceId/invitation/link')
  async createInvitationLink(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(createSpaceInvitationLinkRoSchema))
    spaceInvitationLinkRo: CreateSpaceInvitationLinkRo
  ): Promise<CreateSpaceInvitationLinkVo> {
    return this.invitationService.generateInvitationLink({
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
      role: spaceInvitationLinkRo.role,
    });
  }

  @Permissions('space|invite_link')
  @Delete(':spaceId/invitation/link/:invitationId')
  async deleteInvitationLink(
    @Param('spaceId') spaceId: string,
    @Param('invitationId') invitationId: string
  ): Promise<void> {
    return this.invitationService.deleteInvitationLink({
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
      invitationId,
    });
  }

  @Permissions('base|read')
  @Get(':spaceId/base')
  async getBaseList(@Param('spaceId') spaceId: string): Promise<IGetBaseAllVo> {
    return await this.spaceService.getBaseListBySpaceId(spaceId);
  }

  @Permissions('space|invite_link')
  @Patch(':spaceId/invitation/link/:invitationId')
  async updateInvitationLink(
    @Param('spaceId') spaceId: string,
    @Param('invitationId') invitationId: string,
    @Body(new ZodValidationPipe(updateSpaceInvitationLinkRoSchema))
    updateSpaceInvitationLinkRo: UpdateSpaceInvitationLinkRo
  ): Promise<UpdateSpaceInvitationLinkVo> {
    return this.invitationService.updateInvitationLink({
      invitationId,
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
      role: updateSpaceInvitationLinkRo.role,
    });
  }

  @Permissions('space|invite_link')
  @Get(':spaceId/invitation/link')
  async listInvitationLinkBySpace(
    @Param('spaceId') spaceId: string
  ): Promise<ListSpaceInvitationLinkVo> {
    return this.invitationService.getInvitationLink(spaceId, CollaboratorType.Space);
  }

  @Permissions('space|invite_email')
  @Post(':spaceId/invitation/email')
  async emailInvitation(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(emailSpaceInvitationRoSchema))
    emailSpaceInvitationRo: EmailSpaceInvitationRo
  ): Promise<EmailInvitationVo> {
    return this.invitationService.emailInvitationBySpace(spaceId, emailSpaceInvitationRo);
  }

  @Permissions('space|read')
  @Get(':spaceId/collaborators')
  async listCollaborator(
    @Param('spaceId') spaceId: string,
    @Query('includeBase') includeBase?: boolean,
    @Query('includeSystem') includeSystem?: boolean
  ): Promise<ListSpaceCollaboratorVo> {
    return await this.collaboratorService.getListBySpace(spaceId, { includeSystem, includeBase });
  }

  @Patch(':spaceId/collaborators')
  async updateCollaborator(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(updateSpaceCollaborateRoSchema))
    updateSpaceCollaborateRo: UpdateSpaceCollaborateRo
  ): Promise<void> {
    if (
      updateSpaceCollaborateRo.role !== Role.Owner &&
      (await this.collaboratorService.isUniqueOwnerUser(spaceId, updateSpaceCollaborateRo.userId))
    ) {
      throw new BadRequestException('Cannot change the role of the only owner of the space');
    }
    await this.collaboratorService.updateCollaborator({
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
      userId: updateSpaceCollaborateRo.userId,
      role: updateSpaceCollaborateRo.role,
    });
  }

  @Delete(':spaceId/collaborators')
  async deleteCollaborator(
    @Param('spaceId') spaceId: string,
    @Query('userId') userId: string
  ): Promise<void> {
    if (await this.collaboratorService.isUniqueOwnerUser(spaceId, userId)) {
      throw new BadRequestException('Cannot delete the only owner of the space');
    }
    await this.collaboratorService.deleteCollaborator({
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
      userId,
    });
  }

  @Delete(':spaceId/permanent')
  async permanentDeleteSpace(@Param('spaceId') spaceId: string) {
    return await this.spaceService.permanentDeleteSpace(spaceId);
  }
}
