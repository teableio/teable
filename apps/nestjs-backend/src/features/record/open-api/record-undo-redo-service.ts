import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateRecordsRo, IRecordsVo } from '@teable/openapi';
import { Events } from '../../../event-emitter/events';

@Injectable()
export class RecordUndoRedoService {
  private readonly logger = new Logger(RecordUndoRedoService.name);

  constructor(private readonly prismaService: PrismaService) {}

  @OnEvent(Events.CONTROLLER_RECORDS_CREATE)
  createRecords(payload: {
    params: { tableId: string; createRecordsRo: ICreateRecordsRo };
    result: IRecordsVo;
  }) {
    this.logger.log('record created');
  }
}
