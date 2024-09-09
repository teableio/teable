import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { ITrashVo } from '@teable/openapi';
import {
  ITrashRo,
  trashItemsRoSchema,
  trashRoSchema,
  ITrashItemsRo,
  resetTrashItemsRoSchema,
  IResetTrashItemsRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { TrashService } from './trash.service';

@Controller('api/trash/')
export class TrashController {
  constructor(private readonly trashService: TrashService) {}

  @Get()
  async getTrash(@Query(new ZodValidationPipe(trashRoSchema)) query: ITrashRo): Promise<ITrashVo> {
    return await this.trashService.getTrash(query);
  }

  @Get('items')
  async getTrashItems(
    @Query(new ZodValidationPipe(trashItemsRoSchema)) query: ITrashItemsRo
  ): Promise<ITrashVo> {
    return await this.trashService.getTrashItems(query);
  }

  @Post('restore/:trashId')
  async restoreTrash(@Param('trashId') trashId: string): Promise<void> {
    return await this.trashService.restoreTrash(trashId);
  }

  @Delete('reset-items')
  async resetTrashItems(
    @Query(new ZodValidationPipe(resetTrashItemsRoSchema)) query: IResetTrashItemsRo
  ): Promise<void> {
    return await this.trashService.resetTrashItems(query);
  }
}
