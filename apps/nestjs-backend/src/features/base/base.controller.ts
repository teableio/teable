/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
  baseQuerySchemaRo,
  IBaseQuerySchemaRo,
} from '@teable/openapi';
import type {
  ICreateBaseVo,
  IDbConnectionVo,
  IGetBaseAllVo,
  IGetBasePermissionVo,
  IGetBaseVo,
  IUpdateBaseVo,
  ListBaseCollaboratorVo,
} from '@teable/openapi';
import { EmitControllerEvent } from '../../event-emitter/decorators/emit-controller-event.decorator';
import { Events } from '../../event-emitter/events';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../auth/decorators/resource_meta.decorator';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { BaseQueryService } from './base-query/base-query.service';
import { BaseService } from './base.service';
import { DbConnectionService } from './db-connection.service';

@Controller('api/base/')
export class BaseController {
  constructor(
    private readonly baseService: BaseService,
    private readonly dbConnectionService: DbConnectionService,
    private readonly collaboratorService: CollaboratorService,
    private readonly baseQueryService: BaseQueryService
  ) {}

  @Post()
  @Permissions('base|create')
  @ResourceMeta('spaceId', 'body')
  @EmitControllerEvent(Events.BASE_CREATE)
  async createBase(
    @Body(new ZodValidationPipe(createBaseRoSchema))
    createBaseRo: ICreateBaseRo
  ): Promise<ICreateBaseVo> {
    return await this.baseService.createBase(createBaseRo);
  }

  @Post('duplicate')
  @Permissions('base|create')
  @ResourceMeta('spaceId', 'body')
  @EmitControllerEvent(Events.BASE_CREATE)
  async duplicateBase(
    @Body(new ZodValidationPipe(duplicateBaseRoSchema))
    duplicateBaseRo: IDuplicateBaseRo
  ): Promise<ICreateBaseRo> {
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

  @Permissions('base|read')
  @Get(':baseId')
  async getBaseById(@Param('baseId') baseId: string): Promise<IGetBaseVo> {
    return await this.baseService.getBaseById(baseId);
  }

  @Get('access/all')
  async getAllBase(): Promise<IGetBaseAllVo> {
    return this.baseService.getAllBaseList();
  }

  @Get('access/list')
  @TokenAccess()
  async getAccessBase(): Promise<{ id: string; name: string }[]> {
    return this.baseService.getAccessBaseList();
  }

  @Delete(':baseId')
  @Permissions('base|delete')
  @EmitControllerEvent(Events.BASE_DELETE)
  async deleteBase(@Param('baseId') baseId: string) {
    return await this.baseService.deleteBase(baseId);
  }

  @Permissions('base|db_connection')
  @Post(':baseId/connection')
  async createDbConnection(@Param('baseId') baseId: string): Promise<IDbConnectionVo> {
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
  async listCollaborator(@Param('baseId') baseId: string): Promise<ListBaseCollaboratorVo> {
    return await this.collaboratorService.getListByBase(baseId);
  }

  @Permissions('base|read')
  @Get(':baseId/permission')
  async getPermission(): Promise<IGetBasePermissionVo> {
    return await this.baseService.getPermission();
  }

  @Get(':baseId/query')
  async sqlQuery(
    @Param('baseId') baseId: string,
    @Query(new ZodValidationPipe(baseQuerySchemaRo)) query: IBaseQuerySchemaRo
  ) {
    return await this.baseQueryService.baseQuery(baseId, query.query);
  }
}
