import { Injectable } from '@nestjs/common';
import type { IOtOperation, IRecordSnapshot } from '@teable-group/core';
import { generateRecordId, OpBuilder } from '@teable-group/core';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { CreateRecordsDto } from '../create-records.dto';
import { RecordService } from '../record.service';

interface ICreateRecordOpMeta {
  recordId: string;
  snapshot: IRecordSnapshot;
  ops: IOtOperation[];
}

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService
  ) {}

  async multipleCreateRecords(tableId: string, createRecordsDto: CreateRecordsDto) {
    const result = await this.multipleCreateRecords2Ops(tableId, createRecordsDto);
    await this.prismaService.$transaction(async (prisma) => {
      this.transactionService.set(tableId, prisma);
      try {
        for (const opMeta of result) {
          const { snapshot, ops } = opMeta;
          const doc = await this.shareDbService.createDocument(
            tableId,
            snapshot.record.id,
            snapshot
          );
          await new Promise((resolve, reject) => {
            doc.submitOp(ops, undefined, (error) => {
              if (error) return reject(error);
              resolve(undefined);
            });
          });
        }
      } finally {
        this.transactionService.remove(tableId);
      }
    });
  }

  async multipleCreateRecords2Ops(
    tableId: string,
    createRecordsDto: CreateRecordsDto
  ): Promise<ICreateRecordOpMeta[]> {
    const defaultView = await this.prismaService.view.findFirstOrThrow({
      where: { tableId },
      select: { id: true },
    });

    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    const rowCount = await this.recordService.getAllRecordCount(this.prismaService, dbTableName);

    return createRecordsDto.records.map((record, index) => {
      const recordId = generateRecordId();
      const snapshot = OpBuilder.creator.addRecord.build(recordId);

      const setRecordOps = Object.entries(record.fields).map(([fieldId, value]) =>
        OpBuilder.editor.setRecord.build({
          fieldId,
          oldCellValue: null,
          newCellValue: value,
        })
      );
      const setRecordOrderOp = OpBuilder.editor.setRecordOrder.build({
        viewId: defaultView.id,
        newOrder: rowCount + index,
      });

      return {
        recordId,
        snapshot,
        ops: [...setRecordOps, setRecordOrderOp],
      };
    }, []);
  }
}
