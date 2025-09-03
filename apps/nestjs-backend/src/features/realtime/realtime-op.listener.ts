import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events } from '../../event-emitter/events';
import { ICreateFieldsPayload } from '../undo-redo/operations/create-fields.operation';
import { RealtimeOpService } from './realtime-op.service';

@Injectable()
export class RealtimeOpListener {
  private readonly logger = new Logger(RealtimeOpListener.name);

  constructor(private readonly realtimeOpService: RealtimeOpService) {}

  // Use OPERATION_FIELDS_CREATE which fires after computed fields have been calculated
  @OnEvent(Events.OPERATION_FIELDS_CREATE, { async: true })
  async onFieldsCreate(event: ICreateFieldsPayload) {
    try {
      const { tableId, fields } = event;
      const fieldIds: string[] = (fields || []).map((f) => f.id);
      if (!fieldIds.length) return;

      await this.realtimeOpService.publishOnFieldCreate(tableId, fieldIds);
    } catch (e) {
      this.logger.warn(`Realtime publish on field create failed: ${(e as Error).message}`);
    }
  }
}
