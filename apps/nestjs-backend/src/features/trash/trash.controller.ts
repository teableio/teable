import { Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { IdPrefix } from '@teable/core';
import type { IRestoreFieldTrashStreamEvent, ITrashVo, V2Feature } from '@teable/openapi';
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
  protected static readonly restoreTableV2Feature: V2Feature = 'restoreTable';

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
    @Query('tableId') tableId: string | undefined,
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    await this.prepareRestoreTableCanary(trashId, tableId, response);
    if (this.cls.get('useV2')) {
      if (trashId.startsWith(IdPrefix.Operation)) {
        return await this.trashService.restoreTableResourceV2(trashId, tableId);
      }
      return await this.trashService.restoreTrashV2(trashId);
    }
    return await this.trashService.restoreTrash(trashId, tableId);
  }

  @Post('restore-field/:trashId/stream')
  @TokenAccess()
  async restoreFieldTrashStream(
    @Param('trashId') trashId: string,
    @Query('tableId') tableId: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    this.prepareRestoreFieldV2Headers(response);
    const stream = this.trashService.restoreFieldTableResourceV2Stream(trashId, tableId);
    await this.streamRestoreResponse(response, stream);
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

  protected async prepareRestoreTableCanary(
    trashId: string,
    tableId: string | undefined,
    response: Response
  ): Promise<void> {
    const decision = trashId.startsWith(IdPrefix.Operation)
      ? await this.trashService.getRestoreTableResourceV2Decision(trashId, tableId)
      : await this.trashService.getRestoreTableV2Decision(trashId);
    if (!decision) {
      return;
    }

    const feature =
      'feature' in decision ? decision.feature : TrashController.restoreTableV2Feature;
    this.cls.set('useV2', decision.useV2);
    this.cls.set('v2Feature', feature);
    this.cls.set('v2Reason', decision.reason);

    response.setHeader(X_TEABLE_V2_HEADER, decision.useV2 ? 'true' : 'false');
    response.setHeader(X_TEABLE_V2_FEATURE_HEADER, feature);
    response.setHeader(X_TEABLE_V2_REASON_HEADER, decision.reason);
  }

  protected prepareRestoreFieldV2Headers(response: Response): void {
    const feature: V2Feature = 'createField';
    const reason = 'header_override';
    this.cls.set('useV2', true);
    this.cls.set('v2Feature', feature);
    this.cls.set('v2Reason', reason);

    response.setHeader(X_TEABLE_V2_HEADER, 'true');
    response.setHeader(X_TEABLE_V2_FEATURE_HEADER, feature);
    response.setHeader(X_TEABLE_V2_REASON_HEADER, reason);
  }

  protected prepareRestoreStreamResponse(response: Response) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }

  protected isRestoreStreamClosed(response: Response) {
    return response.writableEnded || response.destroyed;
  }

  protected sendRestoreSseEvent(response: Response, data: IRestoreFieldTrashStreamEvent) {
    if (this.isRestoreStreamClosed(response)) {
      return;
    }

    response.write(`data: ${JSON.stringify(data)}\n\n`);
    (response as Response & { flush?: () => void }).flush?.();
  }

  protected startRestoreHeartbeat(response: Response) {
    const heartbeat = setInterval(() => {
      if (this.isRestoreStreamClosed(response)) {
        return;
      }

      response.write(': ping\n\n');
      (response as Response & { flush?: () => void }).flush?.();
    }, 15_000);

    response.on('close', () => clearInterval(heartbeat));
    return heartbeat;
  }

  protected async streamRestoreResponse(
    response: Response,
    stream: AsyncIterable<IRestoreFieldTrashStreamEvent>
  ) {
    this.prepareRestoreStreamResponse(response);
    const heartbeat = this.startRestoreHeartbeat(response);

    try {
      for await (const event of stream) {
        if (this.isRestoreStreamClosed(response)) {
          break;
        }
        this.sendRestoreSseEvent(response, event);
      }
    } catch (error) {
      this.sendRestoreSseEvent(response, {
        id: 'error',
        phase: 'restoring',
        batchIndex: -1,
        totalCount: 0,
        processedCount: 0,
        updatedCount: 0,
        message: error instanceof Error ? error.message : 'Restore stream failed',
      });
    } finally {
      clearInterval(heartbeat);
      response.end();
    }
  }
}
