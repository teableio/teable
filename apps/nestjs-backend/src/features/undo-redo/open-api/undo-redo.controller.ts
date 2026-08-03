import { Controller, Headers, Param, Post, Res } from '@nestjs/common';
import type { IRedoVo, IUndoRedoStreamEvent, IUndoVo } from '@teable/openapi';
import type { Response } from 'express';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UndoRedoService, X_TEABLE_UNDO_REDO_ENGINE_HEADER } from './undo-redo.service';

const undoMode = 'undo';
const redoMode = 'redo';
const tableReadPermission = 'table|read';
const windowIdHeader = 'x-window-id';

@Controller('api/table/:tableId/undo-redo')
export class UndoRedoController {
  constructor(private readonly undoRedoService: UndoRedoService) {}

  @Permissions(tableReadPermission)
  @Post(undoMode)
  async undo(
    @Headers(windowIdHeader) windowId: string,
    @Param('tableId') tableId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<IUndoVo> {
    const result = await this.undoRedoService.undo(tableId, windowId);
    res.setHeader(X_TEABLE_UNDO_REDO_ENGINE_HEADER, result.engine);
    return result.body;
  }

  @Permissions(tableReadPermission)
  @Post(redoMode)
  async redo(
    @Headers(windowIdHeader) windowId: string,
    @Param('tableId') tableId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<IRedoVo> {
    const result = await this.undoRedoService.redo(tableId, windowId);
    res.setHeader(X_TEABLE_UNDO_REDO_ENGINE_HEADER, result.engine);
    return result.body;
  }

  @Permissions(tableReadPermission)
  @Post('undo-stream')
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
      });
    } finally {
      clearInterval(heartbeat);
      if (!this.isUndoRedoStreamClosed(response)) {
        response.end();
      }
    }
  }
}
