import { Controller, Headers, Param, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { IRedoVo, IUndoRedoStreamEvent, IUndoVo } from '@teable/openapi';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../../canary/interceptors/v2-indicator.interceptor';
import { markUnsupportedV2FeatureFallback } from '../../canary/v2-attribution';
import {
  UndoRedoService,
  X_TEABLE_UNDO_REDO_ENGINE_HEADER,
  type IUndoRedoEngine,
} from './undo-redo.service';

const undoMode = 'undo';
const redoMode = 'redo';
const tableReadPermission = 'table|read';
const windowIdHeader = 'x-window-id';

@UseGuards(V2FeatureGuard)
@UseInterceptors(V2IndicatorInterceptor)
@Controller('api/table/:tableId/undo-redo')
export class UndoRedoController {
  constructor(
    private readonly undoRedoService: UndoRedoService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Permissions(tableReadPermission)
  @Post(undoMode)
  @UseV2Feature('undoRedo')
  async undo(
    @Headers(windowIdHeader) windowId: string,
    @Param('tableId') tableId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<IUndoVo> {
    const result = await this.undoRedoService.undo(tableId, windowId);
    this.applyUndoRedoEngineAttribution(result.engine, result.body.status);
    res.setHeader(X_TEABLE_UNDO_REDO_ENGINE_HEADER, result.engine);
    return result.body;
  }

  @Permissions(tableReadPermission)
  @Post(redoMode)
  @UseV2Feature('undoRedo')
  async redo(
    @Headers(windowIdHeader) windowId: string,
    @Param('tableId') tableId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<IRedoVo> {
    const result = await this.undoRedoService.redo(tableId, windowId);
    this.applyUndoRedoEngineAttribution(result.engine, result.body.status);
    res.setHeader(X_TEABLE_UNDO_REDO_ENGINE_HEADER, result.engine);
    return result.body;
  }

  @Permissions(tableReadPermission)
  @Post('undo-stream')
  @UseV2Feature('undoRedo')
  async undoStream(
    @Headers(windowIdHeader) windowId: string,
    @Param('tableId') tableId: string,
    @Res() response: Response
  ): Promise<void> {
    await this.streamUndoRedoResponse(
      response,
      undoMode,
      this.undoRedoService.undoStream(tableId, windowId)
    );
  }

  @Permissions(tableReadPermission)
  @Post('redo-stream')
  @UseV2Feature('undoRedo')
  async redoStream(
    @Headers(windowIdHeader) windowId: string,
    @Param('tableId') tableId: string,
    @Res() response: Response
  ): Promise<void> {
    await this.streamUndoRedoResponse(
      response,
      redoMode,
      this.undoRedoService.redoStream(tableId, windowId)
    );
  }

  // The replay engine is chosen by the service (v2 stack first, v1 fallback) and
  // is independent of the canary decision the guard recorded, so a v1 replay of a
  // request the canary routed to v2 would otherwise be stamped `x-teable-v2: true`.
  // Correct CLS before returning: V2IndicatorInterceptor re-reads it after the
  // handler, and `x-teable-undo-redo-engine` (set by the caller) already reports v1.
  //
  // An `empty` result means no engine replayed anything — the service reports the
  // nominal v1 engine for it — so the canary stamp is kept there, matching the
  // stream routes, where the same request cannot be corrected either.
  private applyUndoRedoEngineAttribution(engine: IUndoRedoEngine, status: IUndoVo['status']) {
    if (engine !== 'v1' || status === 'empty') {
      return;
    }

    markUnsupportedV2FeatureFallback(this.cls);
  }

  // A streaming response flushes its headers before the handler returns, so the
  // V2 attribution lands via V2IndicatorInterceptor's pre-handler stamp (the guard
  // has already recorded the decision in CLS by then); the interceptor's
  // post-handler pass is skipped once the response is on the wire.
  //
  // Known limitation: the engine is only picked once the stream starts producing
  // events (v2 stack first, v1 fallback on an empty v2 stack), which is after these
  // headers are flushed, so a v1 replay on a stream keeps the canary-decision stamp
  // (the non-stream routes above correct it instead). The engine of a streamed
  // replay is reported by the `engine` field of every progress/done event.
  private prepareUndoRedoStreamResponse(response: Response) {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }

  private isUndoRedoStreamClosed(response: Response) {
    return response.writableEnded || response.destroyed;
  }

  private sendUndoRedoSseEvent(response: Response, data: IUndoRedoStreamEvent) {
    if (this.isUndoRedoStreamClosed(response)) {
      return;
    }
    response.write(`data: ${JSON.stringify(data)}\n\n`);
    (response as Response & { flush?: () => void }).flush?.();
  }

  private startUndoRedoHeartbeat(response: Response) {
    const heartbeat = setInterval(() => {
      if (this.isUndoRedoStreamClosed(response)) {
        return;
      }
      response.write(': ping\n\n');
      (response as Response & { flush?: () => void }).flush?.();
    }, 15_000);

    response.on('close', () => clearInterval(heartbeat));
    return heartbeat;
  }

  private async streamUndoRedoResponse(
    response: Response,
    mode: typeof undoMode | typeof redoMode,
    stream: AsyncIterable<IUndoRedoStreamEvent>
  ) {
    this.prepareUndoRedoStreamResponse(response);
    const heartbeat = this.startUndoRedoHeartbeat(response);

    try {
      for await (const event of stream) {
        if (this.isUndoRedoStreamClosed(response)) {
          break;
        }
        this.sendUndoRedoSseEvent(response, event);
      }
    } catch (error) {
      this.sendUndoRedoSseEvent(response, {
        id: 'error',
        mode,
        message: error instanceof Error ? error.message : 'Undo/redo stream failed',
        // A refused v1 replay surfaces here (the stream already answered 200):
        // keep the http error code so the client can tell a 403 from a failure.
        ...(error instanceof CustomHttpException ? { code: error.code } : {}),
      });
    } finally {
      clearInterval(heartbeat);
      if (!this.isUndoRedoStreamClosed(response)) {
        response.end();
      }
    }
  }
}
