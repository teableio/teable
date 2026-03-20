import { Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { ITrashVo } from '@teable/openapi';
import {
  ITrashRo,
  trashItemsRoSchema,
  trashRoSchema,
  ITrashItemsRo,
  resetTrashItemsRoSchema,
  IResetTrashItemsRo,
} from '@teable/openapi';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { TokenAccess } from '../auth/decorators/token.decorator';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../canary/interceptors/v2-indicator.interceptor';
import { TrashService } from './trash.service';

@Controller('api/trash/')
export class TrashController {
  protected static readonly restoreTableV2Feature = 'restoreTable';

  constructor(
    private readonly trashService: TrashService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Get()
  async getTrash(@Query(new ZodValidationPipe(trashRoSchema)) query: ITrashRo): Promise<ITrashVo> {
    return await this.trashService.getTrash(query);
  }

  @Get('items')
  @TokenAccess()
  async getTrashItems(
    @Query(new ZodValidationPipe(trashItemsRoSchema)) query: ITrashItemsRo
  ): Promise<ITrashVo> {
    return await this.trashService.getTrashItems(query);
  }

  @Post('restore/:trashId')
  @TokenAccess()
  async restoreTrash(
    @Param('trashId') trashId: string,
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    await this.prepareRestoreTableCanary(trashId, response);
    if (this.cls.get('useV2')) {
      return await this.trashService.restoreTrashV2(trashId);
    }
    return await this.trashService.restoreTrash(trashId);
  }

  @Delete('reset-items')
  @TokenAccess()
  async resetTrashItems(
    @Query(new ZodValidationPipe(resetTrashItemsRoSchema)) query: IResetTrashItemsRo
  ): Promise<void> {
    return await this.trashService.resetTrashItems(query);
  }

  @Delete(':trashId')
  @TokenAccess()
  async delete(@Param('trashId') trashId: string): Promise<void> {
    return await this.trashService.delete(trashId);
  }

  protected async prepareRestoreTableCanary(trashId: string, response: Response): Promise<void> {
    const decision = await this.trashService.getRestoreTableV2Decision(trashId);
    if (!decision) {
      return;
    }

    this.cls.set('useV2', decision.useV2);
    this.cls.set('v2Feature', TrashController.restoreTableV2Feature);
    this.cls.set('v2Reason', decision.reason);

    response.setHeader(X_TEABLE_V2_HEADER, decision.useV2 ? 'true' : 'false');
    response.setHeader(X_TEABLE_V2_FEATURE_HEADER, TrashController.restoreTableV2Feature);
    response.setHeader(X_TEABLE_V2_REASON_HEADER, decision.reason);
  }
}
