import { Injectable } from '@nestjs/common';
import type { IOtOperation, IRecordSnapshot } from '@teable-group/core';
import { generateRecordId, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
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
    private readonly shareDbService: ShareDbService
  ) {}

  async multipleCreateRecords(tableId: string, createRecordsDto: CreateRecordsDto) {
    await this.prismaService.$transaction(async (prisma) => {
      const result = await this.multipleCreateRecords2Ops(prisma, tableId, createRecordsDto);
      for (const opMeta of result) {
        const { snapshot, ops } = opMeta;
        const doc = await this.shareDbService.createDocument(
          prisma,
          tableId,
          snapshot.record.id,
          snapshot
        );
        await new Promise((resolve, reject) => {
          doc.submitOp(
            ops,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { source: { transactionClient: prisma } } as any,
            (error) => {
              if (error) return reject(error);
              resolve(undefined);
            }
          );
        });
      }
    });
  }

  async multipleCreateRecords2Ops(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createRecordsDto: CreateRecordsDto
  ): Promise<ICreateRecordOpMeta[]> {
    const defaultView = await prisma.view.findFirstOrThrow({
      where: { tableId },
      select: { id: true },
    });

    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const rowCount = await this.recordService.getRowCount(prisma, dbTableName);

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
