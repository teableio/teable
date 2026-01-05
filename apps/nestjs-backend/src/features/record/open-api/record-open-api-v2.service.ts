import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import type { IUpdateRecordRo, IRecord, ICreateRecordsRo } from '@teable/openapi';
import {
  executeCreateRecordsEndpoint,
  executeUpdateRecordEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { v2CoreTokens, ActorId } from '@teable/v2-core';
import type { ICommandBus } from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { V2ContainerService } from '../../v2/v2-container.service';

@Injectable()
export class RecordOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async updateRecord(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const userId = this.cls.get('user.id');
    const actorIdResult = ActorId.create(userId);
    if (actorIdResult.isErr()) {
      throw new HttpException(actorIdResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // Convert v1 input format to v2 format
    // v1: { record: { fields: { fieldKey: value } } }
    // v2: { tableId, recordId, fields: { fieldId: value } }
    const v2Input = {
      tableId,
      recordId,
      fields: updateRecordRo.record.fields,
    };

    const result = await executeUpdateRecordEndpoint(
      { actorId: actorIdResult.value },
      v2Input,
      commandBus
    );
    if (result.status === 200 && result.body.ok) {
      // Convert v2 output to v1 format
      const v2Record = result.body.data.record;
      return {
        id: v2Record.id,
        fields: v2Record.fields,
      } as IRecord;
    }

    if (!result.body.ok) {
      throw new HttpException(result.body.error.message, result.status);
    }

    throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async createRecords(tableId: string, createRecordsRo: ICreateRecordsRo) {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const userId = this.cls.get('user.id');
    const actorIdResult = ActorId.create(userId);
    if (actorIdResult.isErr()) {
      throw new HttpException(actorIdResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const result = await executeCreateRecordsEndpoint(
      { actorId: actorIdResult.value },
      { tableId, records: createRecordsRo.records },
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      return result.body.data;
    }

    if (!result.body.ok) {
      throw new HttpException(result.body.error.message, result.status);
    }

    throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
