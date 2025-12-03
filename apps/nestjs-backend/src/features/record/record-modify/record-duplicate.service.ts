import { Injectable } from '@nestjs/common';
import { FieldKeyType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRecordInsertOrderRo, IRecord } from '@teable/openapi';
import { CustomHttpException } from '../../../custom.exception';
import { TableDomainQueryService } from '../../table-domain';
import { RecordService } from '../record.service';
import { RecordCreateService } from './record-create.service';

@Injectable()
export class RecordDuplicateService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly recordCreateService: RecordCreateService,
    private readonly tableDomainQueryService: TableDomainQueryService
  ) {}

  async duplicateRecord(
    tableId: string,
    recordId: string,
    order: IRecordInsertOrderRo,
    projection?: string[]
  ): Promise<IRecord> {
    const query = { fieldKeyType: FieldKeyType.Id, projection };
    const table = await this.tableDomainQueryService.getTableDomainById(tableId);
    const result = await this.recordService.getRecord(tableId, recordId, query).catch(() => null);
    if (!result) {
      throw new CustomHttpException(`Record ${recordId} not found`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.record.notFound',
        },
      });
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
          table,
          createRecordsRo.records,
          FieldKeyType.Id,
          projection
        )
      )
      .then((res) => {
        if (!res.records[0]) {
          throw new CustomHttpException('Duplicate record failed', HttpErrorCode.VALIDATION_ERROR, {
            localization: {
              i18nKey: 'httpErrors.record.duplicateFailed',
            },
          });
        }
        return res.records[0];
      });
  }
}
