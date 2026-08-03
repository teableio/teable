import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AttachmentsTableService } from '../../features/attachments/attachments-table.service';
import {
  Events,
  FieldDeleteEvent,
  RecordDeleteEvent,
  RecordCreateEvent,
  RecordUpdateEvent,
} from '../events';

@Injectable()
export class AttachmentListener {
  constructor(private readonly attachmentsTableService: AttachmentsTableService) {}

  @OnEvent(Events.TABLE_RECORD_CREATE, { async: true })
  async recordCreateListener(listenerEvent: RecordCreateEvent) {
    const {
      payload: { record, tableId },
      context,
    } = listenerEvent;
    await this.attachmentsTableService.createRecords(
      context.user!.id,
      tableId,
      Array.isArray(record) ? record : [record]
    );
  }

  @OnEvent(Events.TABLE_RECORD_DELETE, { async: true })
  async recordDeleteListener(listenerEvent: RecordDeleteEvent) {
    const {
      payload: { tableId, recordId },
    } = listenerEvent;
    await this.attachmentsTableService.deleteRecords(
      tableId,
      Array.isArray(recordId) ? recordId : [recordId]
    );
  }

  @OnEvent(Events.TABLE_RECORD_UPDATE, { async: true })
  async recordUpdateListener(listenerEvent: RecordUpdateEvent) {
    const {
      payload: { tableId, record },
      context,
    } = listenerEvent;
    await this.attachmentsTableService.updateRecords(
      context.user!.id,
      tableId,
      Array.isArray(record) ? record : [record]
    );
  }

  @OnEvent(Events.TABLE_FIELD_DELETE, { async: true })
  async fieldDeleteListener(listenerEvent: FieldDeleteEvent) {
    const {
      payload: { tableId, fieldId },
    } = listenerEvent;

    await this.attachmentsTableService.deleteFields(
      tableId,
      Array.isArray(fieldId) ? fieldId : [fieldId]
    );
  }
}
