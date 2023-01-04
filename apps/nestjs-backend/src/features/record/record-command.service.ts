import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { generateRecordId, OpBuilder } from '@teable-group/core';
import { PrismaService } from '../../prisma.service';
import { ShareDbService } from '../../share-db/share-db.service';
import type { CreateRecordsDto } from './create-records.dto';
import { RecordService } from './record.service';

@Injectable()
export class RecordCommandService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly shareDbService: ShareDbService
  ) {}

  async multipleCreateRecords(tableId: string, createRecordsDto: CreateRecordsDto) {
    const ops = await this.multipleCreateRecords2Ops(tableId, createRecordsDto);
    await this.shareDbService.submitOps('table', tableId, ops);
  }

  async multipleCreateRecords2Ops(tableId: string, createRecordsDto: CreateRecordsDto) {
    const defaultView = await this.prismaService.view.findFirstOrThrow({
      where: { tableId },
      select: { id: true },
    });

    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const rowCount = await this.recordService.getRowCount(this.prismaService, dbTableName);

    return createRecordsDto.records.reduce<IOtOperation[]>((acc, record) => {
      const recordId = generateRecordId();
      const createRecordOp = OpBuilder.items.addRecord.build(recordId);
      const setRecordOps = Object.entries(record.fields).map(([fieldId, value]) =>
        OpBuilder.items.setRecord.build({
          recordId,
          fieldId,
          oldCellValue: null,
          newCellValue: value,
        })
      );
      const addRowOp = OpBuilder.items.addRow.build({
        recordId,
        viewId: defaultView.id,
        rowIndex: rowCount,
      });

      acc.push(createRecordOp, ...setRecordOps, addRowOp);
      return acc;
    }, []);
  }
}
