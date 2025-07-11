import { Controller, Headers, Param, Post } from '@nestjs/common';
import type { IRedoVo, IUndoVo } from '@teable/openapi';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UndoRedoService } from './undo-redo.service';

@Controller('api/table/:tableId/undo-redo')
export class UndoRedoController {
  constructor(private readonly undoRedoService: UndoRedoService) {}

  @Permissions('table|read')
  @Post('undo')
  async undo(
    @Headers('x-window-id') windowId: string,
    @Param('tableId') tableId: string
  ): Promise<IUndoVo> {
    console.log('undo', tableId, windowId);
    return await this.undoRedoService.undo(tableId, windowId);
  }

  @Permissions('table|read')
  @Post('redo')
  async redo(
    @Headers('x-window-id') windowId: string,
    @Param('tableId') tableId: string
  ): Promise<IRedoVo> {
    return await this.undoRedoService.redo(tableId, windowId);
  }
}
