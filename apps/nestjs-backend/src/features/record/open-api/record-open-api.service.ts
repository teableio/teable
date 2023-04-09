import { Injectable } from '@nestjs/common';
import type { IOtOperation, IRecordSnapshot } from '@teable-group/core';
import { generateTransactionKey, IdPrefix, generateRecordId, OpBuilder } from '@teable-group/core';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { FieldKeyType } from '../constant';
import type { CreateRecordsDto } from '../create-records.dto';

interface ICreateRecordOpMeta {
  snapshot: IRecordSnapshot;
  ops?: IOtOperation[];
}

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService
  ) {}

  // if ops create and sent in a same tick, they will be wrap in a same transaction
  // and this is important for keep data safe
  async multipleCreateRecords(
    tableId: string,
    createRecordsDto: CreateRecordsDto,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const result = await this.multipleCreateRecords2Ops(tableId, createRecordsDto, transactionMeta);
    const connection = this.shareDbService.connect();
    transactionMeta = transactionMeta || {
      transactionKey: generateTransactionKey(),
      opCount:
        result.length +
        result.reduce((pre, cur) => {
          cur.ops && pre++;
          return pre;
        }, 0),
    };

    for (const opMeta of result) {
      const { snapshot, ops } = opMeta;
      const collection = `${IdPrefix.Record}_${tableId}`;
      const docId = snapshot.record.id;
      const doc = connection.get(collection, docId);
      await new Promise<void>((resolve, reject) => {
        doc.create(snapshot, undefined, transactionMeta, (error) => {
          if (error) return reject(error);
          resolve(undefined);
        });
      });

      if (!ops) {
        continue;
      }

      await new Promise((resolve, reject) => {
        doc.submitOp(ops, transactionMeta, (error) => {
          if (error) return reject(error);
          resolve(undefined);
        });
      });
    }
  }

  async multipleCreateRecords2Ops(
    tableId: string,
    createRecordsDto: CreateRecordsDto,
    transactionMeta?: { transactionKey: string; opCount: number }
  ): Promise<ICreateRecordOpMeta[]> {
    const fieldKey = createRecordsDto.fieldKeyType;
    const prisma = await this.transactionService.getTransaction(transactionMeta);
    const allFields = await prisma.field.findMany({
      where: { tableId },
      select: { id: true, name: true },
    });

    let fieldName2IdMap: { [name: string]: string } = {};
    if (fieldKey !== FieldKeyType.Id) {
      fieldName2IdMap = allFields.reduce<{ [name: string]: string }>((pre, cur) => {
        pre[cur.name] = cur.id;
        return pre;
      }, {});
    }

    return createRecordsDto.records.map((record) => {
      const recordId = generateRecordId();
      const snapshot = OpBuilder.creator.addRecord.build({
        record: { id: recordId, fields: {} },
        recordOrder: {},
      });

      const setRecordOps = Object.entries(record.fields).map(([fieldNameOrId, value]) => {
        let fieldId = fieldNameOrId;
        if (fieldKey !== FieldKeyType.Id) {
          fieldId = fieldName2IdMap[fieldNameOrId];
        }

        return OpBuilder.editor.setRecord.build({
          fieldId,
          oldCellValue: null,
          newCellValue: value,
        });
      });

      return {
        snapshot,
        ops: setRecordOps.length ? setRecordOps : undefined,
      };
    }, []);
  }
}
