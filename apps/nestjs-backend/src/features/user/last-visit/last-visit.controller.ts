import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { Action } from '@teable/core';
import type {
  IUserLastVisitBaseNodeVo,
  IUserLastVisitListBaseNodeVo,
  IUserLastVisitListBaseVo,
  IUserLastVisitMapVo,
  IUserLastVisitVo,
} from '@teable/openapi';
import {
  IGetUserLastVisitRo,
  IGetUserLastVisitBaseNodeRo,
  IGetUserLastVisitListBaseNodeRo,
  IUpdateUserLastVisitRo,
  LastVisitResourceType,
  TrashType,
  getUserLastVisitBaseNodeRoSchema,
  getUserLastVisitListBaseNodeRoSchema,
  getUserLastVisitRoSchema,
  updateUserLastVisitRoSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { PermissionService } from '../../auth/permission.service';
import { RESOURCE_DESCRIPTORS } from '../../resource/resource-descriptor';
import { BASE_NODE_VISIT_TYPES } from './last-visit-types';
import { LastVisitService } from './last-visit.service';

/**
 * What the caller must hold on `parentResourceId` before a lookup may answer: reading the base
 * for the node types, the table for its views. Space lookups read only the caller's own visit rows.
 */
const parentReadPermission = (type: LastVisitResourceType): Action | undefined => {
  if (type === LastVisitResourceType.View)
    return RESOURCE_DESCRIPTORS[TrashType.Table].actions.read;
  if (BASE_NODE_VISIT_TYPES.includes(type))
    return RESOURCE_DESCRIPTORS[TrashType.Base].actions.read;
  return undefined;
};

@Controller('api/user/last-visit')
export class LastVisitController {
  constructor(
    private readonly lastVisitService: LastVisitService,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService
  ) {}

  /**
   * The lookups fall back to the first child of `parentResourceId` when the caller never
   * visited it, so they answer only for a parent the caller can read; for any other id they
   * return nothing, which every caller already treats as "no last visit" (pentest
   * IDOR-VULN-03: a foreign base id used to hand back that tenant's table and view ids).
   */
  private canReadParent(permission: Action | undefined, parentResourceId: string) {
    if (!permission) return Promise.resolve(true);
    return this.permissionService
      .validPermissions(parentResourceId, [permission], this.cls.get('accessTokenId'))
      .then(
        () => true,
        () => false
      );
  }

  @Get()
  async getUserLastVisit(
    @Query(new ZodValidationPipe(getUserLastVisitRoSchema)) params: IGetUserLastVisitRo
  ): Promise<IUserLastVisitVo | undefined> {
    const permission = parentReadPermission(params.resourceType);
    if (!(await this.canReadParent(permission, params.parentResourceId))) {
      return undefined;
    }
    const userId = this.cls.get('user.id');
    return this.lastVisitService.getUserLastVisit(userId, params);
  }

  @Post()
  async updateUserLastVisit(
    @Body(new ZodValidationPipe(updateUserLastVisitRoSchema))
    updateUserLastVisitRo: IUpdateUserLastVisitRo
  ) {
    const userId = this.cls.get('user.id');
    return this.lastVisitService.updateUserLastVisit(userId, updateUserLastVisitRo);
  }

  @Get('/map')
  async getUserLastVisitMap(
    @Query(new ZodValidationPipe(getUserLastVisitRoSchema)) params: IGetUserLastVisitRo
  ): Promise<IUserLastVisitMapVo> {
    // Always keyed by the tables of the base in `parentResourceId`.
    if (!(await this.canReadParent('base|read', params.parentResourceId))) {
      return {};
    }
    const userId = this.cls.get('user.id');
    return this.lastVisitService.getUserLastVisitMap(userId, params);
  }

  @Get('/list-base')
  async getUserLastVisitListBase(): Promise<IUserLastVisitListBaseVo> {
    return this.lastVisitService.baseVisit();
  }

  @Get('/base-node')
  async getUserLastVisitBaseNode(
    @Query(new ZodValidationPipe(getUserLastVisitBaseNodeRoSchema))
    params: IGetUserLastVisitBaseNodeRo
  ): Promise<IUserLastVisitBaseNodeVo> {
    const userId = this.cls.get('user.id');
    return this.lastVisitService.getUserLastVisitBaseNode(userId, params);
  }

  @Get('/list-base-node')
  async getUserLastVisitListBaseNode(
    @Query(new ZodValidationPipe(getUserLastVisitListBaseNodeRoSchema))
    params: IGetUserLastVisitListBaseNodeRo
  ): Promise<IUserLastVisitListBaseNodeVo> {
    if (!(await this.canReadParent('base|read', params.parentResourceId))) {
      return { total: 0, list: [] };
    }
    const userId = this.cls.get('user.id');
    return this.lastVisitService.listUserLastVisitBaseNode(userId, params.parentResourceId);
  }
}
