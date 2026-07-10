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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { HttpErrorCode, Role } from '@teable/core';
import type {
  ICreateSpaceVo,
  IUpdateSpaceVo,
  IGetSpaceVo,
  IDataDbConnectionSummaryVo,
  IDataDbMigrationJobStatusVo,
  IDataDbPreflightVo,
  EmailInvitationVo,
  ListSpaceInvitationLinkVo,
  CreateSpaceInvitationLinkVo,
  UpdateSpaceInvitationLinkVo,
  ListSpaceCollaboratorVo,
  IGetBaseAllVo,
  ITestLLMVo,
  ISpaceSearchVo,
} from '@teable/openapi';
import {
  createSpaceRoSchema,
  ICreateSpaceRo,
  dataDbPreflightRoSchema,
  IDataDbPreflightRo,
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
  deleteSpaceCollaboratorRoSchema,
  DeleteSpaceCollaboratorRo,
  listSpaceCollaboratorRoSchema,
  ListSpaceCollaboratorRo,
  addSpaceCollaboratorRoSchema,
  AddSpaceCollaboratorRo,
  createIntegrationRoSchema,
  ICreateIntegrationRo,
  updateIntegrationRoSchema,
  IUpdateIntegrationRo,
  testLLMRoSchema,
  ITestLLMRo,
  spaceSearchRoSchema,
  ISpaceSearchRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { EmitControllerEvent } from '../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../event-emitter/events';
import { avatarUploadInterceptorOptions } from '../../utils/avatar';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { InvitationService } from '../invitation/invitation.service';
import { DataDbBindingService } from './data-db-binding.service';
import { DataDbPreflightService } from './data-db-preflight.service';
import {
  migrateSpaceTargetMode,
  spaceDataDbAdminOnlyErrorCode,
  spaceDataDbAdminOnlyMessage,
} from './space-data-db-migration.constants';
import { SpaceDataDbMigrationService } from './space-data-db-migration.service';
import { SpaceService } from './space.service';

const rejectSpaceDataDbMigrationFromSpaceApi = () => {
  throw new CustomHttpException(spaceDataDbAdminOnlyMessage, HttpErrorCode.RESTRICTED_RESOURCE, {
    errorCode: spaceDataDbAdminOnlyErrorCode,
  });
};

@Controller('api/space/')
export class SpaceController {
  constructor(
    protected readonly spaceService: SpaceService,
    protected readonly invitationService: InvitationService,
    protected readonly collaboratorService: CollaboratorService,
    protected readonly dataDbPreflightService: DataDbPreflightService,
    protected readonly dataDbBindingService: DataDbBindingService,
    protected readonly cls: ClsService,
    protected readonly spaceDataDbMigrationService: SpaceDataDbMigrationService
  ) {}

  @Post('data-db/preflight')
  @Permissions('space|create')
  async preflightDataDb(
    @Body(new ZodValidationPipe(dataDbPreflightRoSchema))
    dataDbPreflightRo: IDataDbPreflightRo
  ): Promise<IDataDbPreflightVo> {
    if (dataDbPreflightRo.targetMode === migrateSpaceTargetMode) {
      rejectSpaceDataDbMigrationFromSpaceApi();
    }
    return await this.dataDbPreflightService.preflight(dataDbPreflightRo);
  }

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

  @Permissions('space|update')
  @UseInterceptors(FileInterceptor('file', avatarUploadInterceptorOptions))
  @Patch(':spaceId/avatar')
  async updateSpaceAvatar(
    @Param('spaceId') spaceId: string,
    @UploadedFile() file: Express.Multer.File
  ): Promise<void> {
    return await this.spaceService.updateSpaceAvatar(spaceId, file);
  }

  @Permissions('space|read')
  @Get(':spaceId')
  async getSpaceById(@Param('spaceId') spaceId: string): Promise<IGetSpaceVo> {
    return await this.spaceService.getSpaceById(spaceId);
  }

  @Permissions('space|read')
  @Get(':spaceId/data-db')
  async getSpaceDataDb(@Param('spaceId') spaceId: string): Promise<IDataDbConnectionSummaryVo> {
    return await this.dataDbPreflightService.getSummary(spaceId);
  }

  @Permissions('space|update')
  @Patch(':spaceId/data-db')
  async updateSpaceDataDb(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(dataDbPreflightRoSchema))
    dataDbPreflightRo: IDataDbPreflightRo
  ): Promise<IDataDbConnectionSummaryVo> {
    if (dataDbPreflightRo.targetMode === migrateSpaceTargetMode) {
      rejectSpaceDataDbMigrationFromSpaceApi();
    }
    await this.dataDbBindingService.updateBindingForSpace(
      spaceId,
      this.cls.get('user.id') ?? '',
      dataDbPreflightRo
    );
    return await this.dataDbPreflightService.getSummary(spaceId);
  }

  @Permissions('space|update')
  @Post(':spaceId/data-db/retest')
  async retestSpaceDataDb(@Param('spaceId') spaceId: string): Promise<IDataDbConnectionSummaryVo> {
    await this.dataDbBindingService.retestBinding(spaceId);
    return await this.dataDbPreflightService.getSummary(spaceId);
  }

  @Permissions('space|update')
  @Post(':spaceId/data-db/retry')
  async retrySpaceDataDbMigration(
    @Param('spaceId') spaceId: string
  ): Promise<IDataDbConnectionSummaryVo> {
    await this.dataDbBindingService.retryMigrationForSpace(spaceId);
    return await this.dataDbPreflightService.getSummary(spaceId);
  }

  @Permissions('space|read')
  @Get(':spaceId/data-db/migration/:jobId')
  async getSpaceDataDbMigration(
    @Param('spaceId') spaceId: string,
    @Param('jobId') jobId: string
  ): Promise<IDataDbMigrationJobStatusVo> {
    rejectSpaceDataDbMigrationFromSpaceApi();
    return await this.spaceDataDbMigrationService.getMigrationJobStatus(spaceId, jobId);
  }

  @Permissions('space|update')
  @Post(':spaceId/data-db/migration/:jobId/cancel')
  async cancelSpaceDataDbMigration(
    @Param('spaceId') spaceId: string,
    @Param('jobId') jobId: string
  ): Promise<IDataDbMigrationJobStatusVo> {
    rejectSpaceDataDbMigrationFromSpaceApi();
    return await this.spaceDataDbMigrationService.cancelMigrationForSpace(
      spaceId,
      jobId,
      this.cls.get('user.id') ?? ''
    );
  }

  @Permissions('space|update')
  @Post(':spaceId/data-db/migration/:jobId/rollback')
  async rollbackSpaceDataDbMigration(
    @Param('spaceId') spaceId: string,
    @Param('jobId') jobId: string
  ): Promise<IDataDbMigrationJobStatusVo> {
    rejectSpaceDataDbMigrationFromSpaceApi();
    return await this.spaceDataDbMigrationService.rollbackMigrationForSpace(
      spaceId,
      jobId,
      this.cls.get('user.id') ?? ''
    );
  }

  @Permissions('space|read')
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

  @Permissions('space|read')
  @Get(':spaceId/search')
  async search(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(spaceSearchRoSchema)) query: ISpaceSearchRo
  ): Promise<ISpaceSearchVo> {
    return await this.spaceService.search(spaceId, query);
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
    @Query(new ZodValidationPipe(listSpaceCollaboratorRoSchema))
    options: ListSpaceCollaboratorRo
  ): Promise<ListSpaceCollaboratorVo> {
    const stats = await this.collaboratorService.getSpaceCollaboratorStats(spaceId, options);
    return {
      collaborators: await this.collaboratorService.getListBySpace(spaceId, options),
      total: stats.total,
      uniqTotal: stats.uniqTotal,
    };
  }

  @Patch(':spaceId/collaborators')
  @Permissions('space|read')
  async updateCollaborator(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(updateSpaceCollaborateRoSchema))
    updateSpaceCollaborateRo: UpdateSpaceCollaborateRo
  ): Promise<void> {
    if (
      updateSpaceCollaborateRo.role !== Role.Owner &&
      (await this.collaboratorService.isUniqueOwnerUser(
        spaceId,
        updateSpaceCollaborateRo.principalId
      ))
    ) {
      throw new CustomHttpException(
        'Cannot change the role of the only owner of the space',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.space.cannotChangeOnlyOwnerRole',
          },
        }
      );
    }
    await this.collaboratorService.updateCollaborator({
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
      ...updateSpaceCollaborateRo,
    });
  }

  @Delete(':spaceId/collaborators')
  @Permissions('space|read')
  async deleteCollaborator(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(deleteSpaceCollaboratorRoSchema))
    deleteSpaceCollaboratorRo: DeleteSpaceCollaboratorRo
  ): Promise<void> {
    if (
      await this.collaboratorService.isUniqueOwnerUser(
        spaceId,
        deleteSpaceCollaboratorRo.principalId
      )
    ) {
      throw new CustomHttpException(
        'Cannot delete the only owner of the space',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.space.cannotDeleteOnlyOwner',
          },
        }
      );
    }
    await this.collaboratorService.deleteCollaborator({
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
      ...deleteSpaceCollaboratorRo,
    });
  }

  @Delete(':spaceId/permanent')
  @EmitControllerEvent(Events.SPACE_DELETE)
  async permanentDeleteSpace(@Param('spaceId') spaceId: string) {
    await this.spaceService.permanentDeleteSpace(spaceId);
    return { spaceId, permanent: true };
  }

  @Permissions('space|read')
  @Post(':spaceId/collaborator')
  async addCollaborators(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(addSpaceCollaboratorRoSchema))
    addSpaceCollaboratorRo: AddSpaceCollaboratorRo
  ) {
    return this.collaboratorService.addSpaceCollaborators(spaceId, addSpaceCollaboratorRo);
  }

  @Permissions('space|update')
  @Get(':spaceId/integration')
  async getIntegrationList(@Param('spaceId') spaceId: string) {
    return this.spaceService.getIntegrationList(spaceId);
  }

  @Permissions('space|update')
  @Post(':spaceId/integration')
  async createIntegration(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(createIntegrationRoSchema))
    addIntegrationRo: ICreateIntegrationRo
  ) {
    return this.spaceService.createIntegration(spaceId, addIntegrationRo);
  }

  @Permissions('space|update')
  @Patch(':spaceId/integration/:integrationId')
  async updateIntegration(
    @Param('spaceId') spaceId: string,
    @Param('integrationId') integrationId: string,
    @Body(new ZodValidationPipe(updateIntegrationRoSchema))
    updateIntegrationRo: IUpdateIntegrationRo
  ) {
    return this.spaceService.updateIntegration(integrationId, updateIntegrationRo, spaceId);
  }

  @Permissions('space|update')
  @Delete(':spaceId/integration/:integrationId')
  async deleteIntegration(
    @Param('spaceId') spaceId: string,
    @Param('integrationId') integrationId: string
  ) {
    return this.spaceService.deleteIntegration(integrationId, spaceId);
  }

  @Permissions('space|update')
  @Post(':spaceId/test-llm')
  async testIntegrationLLM(
    @Param('spaceId') _spaceId: string,
    @Body(new ZodValidationPipe(testLLMRoSchema)) testLLMRo: ITestLLMRo
  ): Promise<ITestLLMVo> {
    return await this.spaceService.testIntegrationLLM(testLLMRo);
  }
}
