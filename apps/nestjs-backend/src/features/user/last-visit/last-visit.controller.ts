import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type {
  IUserLastVisitListBaseVo,
  IUserLastVisitMapVo,
  IUserLastVisitVo,
} from '@teable/openapi';
import {
  IGetUserLastVisitRo,
  IUpdateUserLastVisitRo,
  getUserLastVisitRoSchema,
  updateUserLastVisitRoSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { LastVisitService } from './last-visit.service';

@Controller('api/user/last-visit')
export class LastVisitController {
  constructor(
    private readonly lastVisitService: LastVisitService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Get()
  async getUserLastVisit(
    @Query(new ZodValidationPipe(getUserLastVisitRoSchema)) params: IGetUserLastVisitRo
  ): Promise<IUserLastVisitVo | undefined> {
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
    const userId = this.cls.get('user.id');
    return this.lastVisitService.getUserLastVisitMap(userId, params);
  }

  @Get('/list-base')
  async getUserLastVisitListBase(): Promise<IUserLastVisitListBaseVo> {
    return this.lastVisitService.baseVisit();
  }
}
