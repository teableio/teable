import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IOtOperation, IRecordSnapshot } from '@teable-group/core';
import {
  FieldKeyType,
  generateTransactionKey,
  IdPrefix,
  generateRecordId,
  OpBuilder,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { IFieldInstance } from '../../../features/field/model/factory';
import { createFieldInstanceByRaw } from '../../../features/field/model/factory';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { CreateRecordsRo } from '../create-records.ro';
import { RecordService } from '../record.service';
import type { UpdateRecordRoByIndexRo } from '../update-record-by-index.ro';
import type { UpdateRecordRo } from '../update-record.ro';

interface ICreateRecordOpMeta {
  snapshot: IRecordSnapshot;
  ops?: IOtOperation[];
}

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly recordService: RecordService,
    private readonly transactionService: TransactionService
  ) {}

  // if ops create and sent in a same tick, they will be wrap in a same transaction
  // and this is important for keep data safe
  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: CreateRecordsRo,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const result = await this.multipleCreateRecords2Ops(tableId, createRecordsRo, transactionMeta);
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

  private async getFieldInstanceMap(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldKeyType: FieldKeyType | undefined
  ) {
    const allFields = await prisma.field.findMany({
      where: { tableId },
    });

    return allFields.reduce<{ [name: string]: IFieldInstance }>((pre, cur) => {
      const field = createFieldInstanceByRaw(cur);
      if (fieldKeyType !== FieldKeyType.Id) {
        pre[cur.name] = field;
      } else {
        pre[cur.id] = field;
      }
      return pre;
    }, {});
  }

  async multipleCreateRecords2Ops(
    tableId: string,
    createRecordsDto: CreateRecordsRo,
    transactionMeta?: { transactionKey: string; opCount: number }
  ): Promise<ICreateRecordOpMeta[]> {
    const fieldKey = createRecordsDto.fieldKeyType;
    const prisma = await this.transactionService.getTransaction(transactionMeta);

    const fieldName2IdMap = await this.getFieldInstanceMap(prisma, tableId, fieldKey);

    return createRecordsDto.records.map((record) => {
      const recordId = generateRecordId();
      const snapshot = OpBuilder.creator.addRecord.build({
        record: { id: recordId, fields: {} },
        recordOrder: {},
      });

      const setRecordOps = Object.entries(record.fields).map(([fieldNameOrId, value]) => {
        const field = fieldName2IdMap[fieldNameOrId];
        const newCellValue = field.repair(value);

        return OpBuilder.editor.setRecord.build({
          fieldId: field.id,
          oldCellValue: null,
          newCellValue,
        });
      });

      return {
        snapshot,
        ops: setRecordOps.length ? setRecordOps : undefined,
      };
    }, []);
  }

  async multipleUpdateRecords2Ops(
    tableId: string,
    updateRecordByIdsRo: (UpdateRecordRo & { recordId: string })[],
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const { fieldKeyType } = updateRecordByIdsRo[0];
    const prisma = await this.transactionService.getTransaction(transactionMeta);
    const dbFieldNameSet = new Set<string>();

    const fieldName2IdMap = await this.getFieldInstanceMap(prisma, tableId, fieldKeyType);

    updateRecordByIdsRo.forEach((updateRecordByIdRo) => {
      Object.keys(updateRecordByIdRo.record.fields).forEach((k) => dbFieldNameSet.add(k));
    });
    const projection = Array.from(dbFieldNameSet).reduce<Record<string, boolean>>((pre, cur) => {
      pre[cur] = true;
      return pre;
    }, {});

    const recordIds = updateRecordByIdsRo.map((updateRecordByIdRo) => updateRecordByIdRo.recordId);

    // get old record value from db
    const snapshots = await this.recordService.getSnapshotBulk(
      prisma,
      tableId,
      recordIds,
      projection,
      fieldKeyType
    );

    return updateRecordByIdsRo.map((updateRecordByIdRo, index) => {
      const snapshot = snapshots[index].data.record;
      const {
        record: { fields },
      } = updateRecordByIdRo;

      const setRecordOps = Object.entries(fields).map(([fieldNameOrId, value]) => {
        const field = fieldName2IdMap[fieldNameOrId];
        const oldCellValue = snapshot.fields[fieldNameOrId];
        const newCellValue = field.repair(value);
        return OpBuilder.editor.setRecord.build({
          fieldId: field.id,
          oldCellValue,
          newCellValue,
        });
      });

      return {
        ops: setRecordOps.length ? setRecordOps : undefined,
      };
    }, []);
  }

  async updateRecordById(
    tableId: string,
    recordId: string,
    updateRecordRo: UpdateRecordRo,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const result = await this.multipleUpdateRecords2Ops(
      tableId,
      [{ ...updateRecordRo, recordId }],
      transactionMeta
    );

    const connection = this.shareDbService.connect();
    transactionMeta = transactionMeta || {
      transactionKey: generateTransactionKey(),
      opCount: result.reduce((pre, cur) => {
        cur.ops && pre++;
        return pre;
      }, 0),
    };

    const opMeta = result[0];
    const { ops } = opMeta;
    const collection = `${IdPrefix.Record}_${tableId}`;

    if (!ops) {
      throw new HttpException('nothing to update', HttpStatus.BAD_REQUEST);
    }

    const doc = connection.get(collection, recordId);
    doc.fetch();

    await new Promise((resolve, reject) => {
      doc.on('load', () => {
        doc.submitOp(ops, transactionMeta, (error) => {
          if (error) return reject(error);
          resolve(undefined);
        });
      });
    });
  }

  async updateRecordByIndex(
    tableId: string,
    updateRecordRoByIndexRo: UpdateRecordRoByIndexRo,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const { viewId, index, ...updateRecordRo } = updateRecordRoByIndexRo;
    const prisma = await this.transactionService.getTransaction(transactionMeta);
    const recordId = await this.recordService.getRecordIdByIndex(prisma, tableId, viewId, index);

    return await this.updateRecordById(tableId, recordId, updateRecordRo, transactionMeta);
  }
}
