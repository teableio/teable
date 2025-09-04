import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRecordInsertOrderRo, IRecord } from '@teable/openapi';
import { RecordService } from '../record.service';
import { RecordCreateService } from './record-create.service';

@Injectable()
export class RecordDuplicateService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly recordCreateService: RecordCreateService
  ) {}

  async duplicateRecord(
    tableId: string,
    recordId: string,
    order: IRecordInsertOrderRo,
    projection?: string[]
  ): Promise<IRecord> {
    const query = { fieldKeyType: FieldKeyType.Id, projection };
    const result = await this.recordService.getRecord(tableId, recordId, query).catch(() => null);
    if (!result) {
      throw new NotFoundException(`Record ${recordId} not found`);
    }
    const records = { fields: result.fields };
    const createRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      order,
      records: [records],
    };
    return await this.prismaService
      .$tx(async () =>
        this.recordCreateService.createRecords(
          tableId,
          createRecordsRo.records,
          FieldKeyType.Id,
          projection
        )
      )
      .then((res) => {
        if (!res.records[0]) throw new BadRequestException('Duplicate record failed');
        return res.records[0];
      });
  }
}
