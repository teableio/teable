import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ICreateRecordsRo, IRecordsVo } from '@teable/openapi';
import { Events } from '../../../event-emitter/events';
import { UndoRedoStackService } from './undo-redo-stack.service';

@Injectable()
export class OperationListener {
  private readonly logger = new Logger(OperationListener.name);

  constructor(private readonly undoRedoStackService: UndoRedoStackService) {}

  @OnEvent(Events.CONTROLLER_RECORDS_CREATE)
  async createRecords(payload: {
    windowId?: string;
    params: { tableId: string; createRecordsRo: ICreateRecordsRo };
    result: IRecordsVo;
  }) {
    const { windowId, params, result } = payload;
    if (!windowId) {
      return;
    }

    await this.undoRedoStackService.push(params.tableId, windowId, {
      params,
      result,
    });
  }
}
