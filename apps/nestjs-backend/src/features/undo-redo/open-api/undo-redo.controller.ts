import { Controller, Headers, Param, Post, Res } from '@nestjs/common';
import type { IRedoVo, IUndoVo } from '@teable/openapi';
import type { Response } from 'express';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UndoRedoService, X_TEABLE_UNDO_REDO_ENGINE_HEADER } from './undo-redo.service';

@Controller('api/table/:tableId/undo-redo')
export class UndoRedoController {
  constructor(private readonly undoRedoService: UndoRedoService) {}

  @Permissions('table|read')
  @Post('undo')
  async undo(
    @Headers('x-window-id') windowId: string,
    @Param('tableId') tableId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<IUndoVo> {
    const result = await this.undoRedoService.undo(tableId, windowId);
    res.setHeader(X_TEABLE_UNDO_REDO_ENGINE_HEADER, result.engine);
    return result.body;
  }

  @Permissions('table|read')
  @Post('redo')
  async redo(
    @Headers('x-window-id') windowId: string,
    @Param('tableId') tableId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<IRedoVo> {
    const result = await this.undoRedoService.redo(tableId, windowId);
    res.setHeader(X_TEABLE_UNDO_REDO_ENGINE_HEADER, result.engine);
    return result.body;
  }
}
