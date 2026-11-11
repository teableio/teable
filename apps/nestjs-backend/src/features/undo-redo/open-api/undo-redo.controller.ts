import { Controller, Headers, Param, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { IRedoVo, IUndoRedoStreamEvent, IUndoVo } from '@teable/openapi';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../../canary/interceptors/v2-indicator.interceptor';
import {
  getV2Attribution,
  getV2AttributionSpanAttributes,
  setV2AttributionHeaders,
  setV2AttributionOnCurrentSentryScopes,
} from '../../canary/v2-attribution';
import { getErrorLocalization } from '../../v2/v2-http-error';
import {
  UndoRedoService,
  X_TEABLE_UNDO_REDO_ENGINE_HEADER,
  type IUndoRedoEngine,
  type IUndoRedoReplaySelected,
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
    await this.streamUndoRedoResponse(response, undoMode, (onReplaySelected) =>
      this.undoRedoService.undoStream(tableId, windowId, onReplaySelected)
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
    await this.streamUndoRedoResponse(response, redoMode, (onReplaySelected) =>
      this.undoRedoService.redoStream(tableId, windowId, onReplaySelected)
    );
  }

  // Stack preference, not the canary guard, selects the replay stack. This is
  // not proof that every command used that table engine (legacy stacks can
  // contain v2 commands). Empty results do not prove either stack replayed.
  private applyUndoRedoEngineAttribution(engine: IUndoRedoEngine, status: IUndoVo['status']) {
    if (status === 'empty') {
      return;
    }
    this.cls.set('useV2', engine === 'v2');
    this.cls.set('v2Reason', 'undo_redo_engine');
    const attribution = getV2Attribution(this.cls);
    setV2AttributionOnCurrentSentryScopes(attribution);
    trace.getActiveSpan()?.setAttributes(getV2AttributionSpanAttributes(attribution));
  }

  // Report the replay stack without changing the routing flag while it runs.
  // Legacy archive replay selects its engine from CLS, and forcing it to v1
  // here would bypass the v2 row-scope admission that guarded the request.
  private getReplayAttribution(engine: IUndoRedoEngine) {
    return {
      ...getV2Attribution(this.cls),
      useV2: engine === 'v2',
      v2Reason: 'undo_redo_engine' as const,
    };
  }

  // Report the admitted stack before flushing SSE, but leave CLS routing alone
  // until replay completes. Empty results select neither stack.
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
    createStream: (onReplaySelected: IUndoRedoReplaySelected) => AsyncIterable<IUndoRedoStreamEvent>
  ) {
    let prepared = false;
    let selectedEngine: IUndoRedoEngine | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    const prepare = (engine?: IUndoRedoEngine) => {
      if (prepared || this.isUndoRedoStreamClosed(response)) {
        return;
      }
      if (engine) {
        selectedEngine = engine;
        const attribution = this.getReplayAttribution(engine);
        setV2AttributionOnCurrentSentryScopes(attribution);
        trace.getActiveSpan()?.setAttributes(getV2AttributionSpanAttributes(attribution));
        response.setHeader(X_TEABLE_UNDO_REDO_ENGINE_HEADER, engine);
        setV2AttributionHeaders(response, attribution);
      }
      this.prepareUndoRedoStreamResponse(response);
      heartbeat = this.startUndoRedoHeartbeat(response);
      prepared = true;
    };

    try {
      for await (const event of createStream(prepare)) {
        if (this.isUndoRedoStreamClosed(response)) {
          break;
        }
        prepare(event.id === 'done' && event.status === 'empty' ? undefined : event.engine);
        this.sendUndoRedoSseEvent(response, event);
      }
    } catch (error) {
      prepare();
      const localization = getErrorLocalization(error);
      this.sendUndoRedoSseEvent(response, {
        id: 'error',
        mode,
        message: error instanceof Error ? error.message : 'Undo/redo stream failed',
        // A refused v1 replay surfaces here (the stream already answered 200):
        // keep the http error code so the client can tell a 403 from a failure.
        ...(error instanceof CustomHttpException ? { code: error.code } : {}),
        ...(localization ? { localization } : {}),
      });
    } finally {
      // Routing is only corrected after replay, never while archive operations
      // still read CLS to choose their permission-enforcing engine.
      if (selectedEngine) {
        this.applyUndoRedoEngineAttribution(selectedEngine, 'fulfilled');
      }
      clearInterval(heartbeat);
      if (!this.isUndoRedoStreamClosed(response)) {
        response.end();
      }
    }
  }
}
