import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IOtOperation, IRecord, IRecordSnapshot } from '@teable-group/core';
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
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { ITransactionMeta } from '../../../share-db/transaction.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { ITransactionCreator } from '../../../utils/transaction-creator';
import type { CreateRecordsRo } from '../create-records.ro';
import { RecordService } from '../record.service';
import type { UpdateRecordRoByIndexRo } from '../update-record-by-index.ro';
import type { UpdateRecordRo } from '../update-record.ro';
import type { CreateRecordsVo } from './record.vo';

interface ICreateRecordOpMeta {
  snapshot: IRecordSnapshot;
  ops?: IOtOperation[];
}

@Injectable()
export class RecordOpenApiService implements ITransactionCreator {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly recordService: RecordService,
    private readonly transactionService: TransactionService
  ) {}

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: CreateRecordsRo,
    fieldName2IdMap?: { [fieldIdOrName: string]: IFieldInstance }
  ): Promise<CreateRecordsVo> {
    if (!fieldName2IdMap) {
      fieldName2IdMap = await this.getFieldInstanceMap(
        this.prismaService,
        tableId,
        createRecordsRo.fieldKeyType
      );
    }

    const { creators, afterCreate } = this.generateCreators(
      tableId,
      fieldName2IdMap,
      createRecordsRo
    );
    const transactionMeta = {
      transactionKey: generateTransactionKey(),
      opCount: creators.length,
    };

    const result: Awaited<ReturnType<typeof creators[number]>>[] = [];
    for (const creator of creators) {
      result.push(await creator(transactionMeta));
    }

    return afterCreate(result);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  generateCreators(
    tableId: string,
    fieldName2IdMap: { [fieldIdOrName: string]: IFieldInstance },
    createRecordsRo: CreateRecordsRo
  ) {
    const opMeta = this.multipleCreateRecords2Ops(fieldName2IdMap, createRecordsRo);
    const connection = this.shareDbService.connect();

    const recordCreators: ((
      transactionMeta: ITransactionMeta
    ) => Promise<IRecordSnapshot | void>)[] = [];
    for (const opData of opMeta) {
      const { snapshot, ops } = opData;
      const collection = `${IdPrefix.Record}_${tableId}`;
      const docId = snapshot.record.id;
      const doc = connection.get(collection, docId);
      recordCreators.push((transactionMeta: ITransactionMeta) => {
        return new Promise<void>((resolve, reject) => {
          doc.create(snapshot, undefined, transactionMeta, (error) => {
            if (error) return reject(error);
            resolve(undefined);
          });
        });
      });

      if (!ops) {
        continue;
      }

      recordCreators.push((transactionMeta: ITransactionMeta) => {
        return new Promise<IRecordSnapshot>((resolve, reject) => {
          doc.submitOp(ops, transactionMeta, (error) => {
            if (error) return reject(error);
            resolve(doc.data);
          });
        });
      });
    }

    return {
      creators: recordCreators,
      afterCreate: (result: (IRecordSnapshot | void)[]) => {
        return {
          records: opMeta.map((opData) => {
            let record: IRecord;
            const calculatedSnapshot = result.find(
              (snapshot) => snapshot?.record.id === opData.snapshot.record.id
            );
            if (calculatedSnapshot) {
              record = calculatedSnapshot.record;
            } else {
              record = opData.snapshot.record;
            }
            return record;
          }),
        };
      },
    };
  }

  private async getFieldInstanceMap(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldKeyType: FieldKeyType | undefined
  ) {
    const allFields = await prisma.field.findMany({
      where: { tableId, deletedTime: null },
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

  multipleCreateRecords2Ops(
    fieldName2IdMap: { [fieldIdOrName: string]: IFieldInstance },
    createRecordsDto: CreateRecordsRo
  ): ICreateRecordOpMeta[] {
    return createRecordsDto.records.map<ICreateRecordOpMeta>((record) => {
      const recordId = generateRecordId();
      const snapshot = OpBuilder.creator.addRecord.build({
        record: { id: recordId, fields: {}, recordOrder: {} },
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
  ): Promise<IRecordSnapshot> {
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

    return await new Promise((resolve, reject) => {
      doc.fetch(() => {
        doc.submitOp(ops, transactionMeta, (error: unknown) => {
          if (error) return reject(error);
          resolve(doc.data);
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
