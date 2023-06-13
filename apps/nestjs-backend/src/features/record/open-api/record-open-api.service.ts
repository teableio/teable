import { Injectable } from '@nestjs/common';
import type {
  IOtOperation,
  IRecord,
  IRecordSnapshot,
  ISetRecordOpContext,
} from '@teable-group/core';
import { OpName, FieldKeyType, IdPrefix, generateRecordId, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Doc } from '@teable/sharedb/lib/client';
import { keyBy } from 'lodash';
import { TransactionService } from '../../..//share-db/transaction.service';
import type { IFieldInstance } from '../../../features/field/model/factory';
import { createFieldInstanceByRaw } from '../../../features/field/model/factory';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { IApplyParam, IOpsMap } from '../../calculation/link.service';
import { LinkService } from '../../calculation/link.service';
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
export class RecordOpenApiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly recordService: RecordService,
    private readonly linkService: LinkService
  ) {}

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: CreateRecordsRo,
    transactionKey?: string
  ): Promise<CreateRecordsVo> {
    if (transactionKey) {
      return await this.createRecords(transactionKey, tableId, createRecordsRo);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.createRecords(transactionKey, tableId, createRecordsRo);
      }
    );
  }

  private async generateApplyParams(
    transactionKey: string,
    tableId: string,
    fieldKey: FieldKeyType,
    records: { id: string; fields: { [fieldKey: string]: unknown } }[]
  ) {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const fieldKeys = Array.from(
      records.reduce<Set<string>>((acc, record) => {
        Object.keys(record.fields).forEach((fieldKey) => acc.add(fieldKey));
        return acc;
      }, new Set())
    );

    const fieldRaws = await prisma.field.findMany({
      where: { tableId, [fieldKey]: { in: fieldKeys } },
      select: { id: true, name: true },
    });
    const fieldIdMap = keyBy(fieldRaws, fieldKey);

    const connection = this.shareDbService.getConnection(transactionKey);
    const applyParams: (IApplyParam & { ops: IOtOperation[]; doc: Doc<IRecordSnapshot> })[] = [];
    for (const record of records) {
      const collection = `${IdPrefix.Record}_${tableId}`;
      const doc = connection.get(collection, record.id);
      const snapshot = await new Promise<IRecordSnapshot>((resolve, reject) => {
        doc.fetch((err) => {
          if (err) return reject(err);
          resolve(doc.data);
        });
      });
      const opContexts: ISetRecordOpContext[] = [];
      const ops: IOtOperation[] = [];

      Object.entries(record.fields).forEach(([fieldKey, value]) => {
        const fieldId = fieldIdMap[fieldKey].id;
        const oldCellValue = snapshot.record.fields[fieldId];
        ops.push(
          OpBuilder.editor.setRecord.build({
            fieldId,
            newCellValue: value,
            oldCellValue,
          })
        );
        opContexts.push({
          name: OpName.SetRecord,
          fieldId,
          newValue: value,
          oldValue: oldCellValue,
        });
      });

      applyParams.push({
        tableId,
        recordId: record.id,
        doc,
        ops,
        opContexts,
      });
    }
    return applyParams;
  }

  private async calculateAndSubmitOp(
    transactionKey: string,
    tableId: string,
    fieldKey: FieldKeyType = FieldKeyType.Name,
    records: { id: string; fields: { [fieldKey: string]: unknown } }[]
  ): Promise<IRecordSnapshot[]> {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const applyParams = await this.generateApplyParams(transactionKey, tableId, fieldKey, records);
    // calculate all changes
    const opsMaps: IOpsMap[] = [];
    for (const applyParam of applyParams) {
      const { ops } = applyParam;
      const calculated = await this.linkService.calculate(prisma, applyParam);
      if (calculated) {
        ops.push(...calculated.currentSnapshotOps);
        calculated.otherSnapshotOps && opsMaps.push(calculated.otherSnapshotOps);
      }
    }
    const opsMap = this.linkService.composeOpsMaps(opsMaps);
    // make sure opsMap not overlap with exist applyPrams
    for (const applyParam of applyParams) {
      const { tableId, recordId, ops } = applyParam;
      if (opsMap[tableId]?.[recordId]) {
        const extraOps = opsMap[tableId][recordId];
        ops.push(...extraOps);
        delete opsMap[tableId][recordId];
      }
    }
    // submit other changes
    await this.sendOtherOps(transactionKey, opsMap);

    // submit current changes
    const recordSnapshots: IRecordSnapshot[] = [];
    for (const applyParam of applyParams) {
      const { doc, ops } = applyParam;
      if (!ops.length) {
        continue;
      }
      const snapshot = await new Promise<IRecordSnapshot>((resolve, reject) => {
        doc.submitOp(ops, undefined, (err) => {
          if (err) return reject(err);
          resolve(doc.data);
        });
      });
      recordSnapshots.push(snapshot);
    }
    return recordSnapshots;
  }

  private async sendOtherOps(
    transactionKey: string,
    otherSnapshotOps: { [tableId: string]: { [recordId: string]: IOtOperation[] } }
  ) {
    console.log('sendOpsAfterApply:', JSON.stringify(otherSnapshotOps, null, 2));
    const connection = this.shareDbService.getConnection(transactionKey);
    for (const tableId in otherSnapshotOps) {
      const data = otherSnapshotOps[tableId];
      const collection = `${IdPrefix.Record}_${tableId}`;
      for (const recordId in data) {
        const ops = data[recordId];
        const doc = connection.get(collection, recordId);
        await new Promise((resolve, reject) => {
          doc.fetch((err) => {
            if (err) return reject(err);
            doc.submitOp(ops, undefined, (error) => {
              if (error) {
                console.error('sendOpsAfterApply error:', error);
                return reject(error);
              }
              console.log('sendOpsAfterApply:succeed', ops);
              resolve(undefined);
            });
          });
        });
      }
    }
  }

  private async createRecords(
    transactionKey: string,
    tableId: string,
    createRecordsRo: CreateRecordsRo
  ): Promise<CreateRecordsVo> {
    const snapshots = createRecordsRo.records.map(() => {
      const recordId = generateRecordId();
      return OpBuilder.creator.addRecord.build({
        record: { id: recordId, fields: {}, recordOrder: {} },
      });
    });

    const connection = this.shareDbService.getConnection(transactionKey);

    for (const snapshot of snapshots) {
      const collection = `${IdPrefix.Record}_${tableId}`;
      const docId = snapshot.record.id;
      const doc = connection.get(collection, docId);
      await new Promise<void>((resolve, reject) => {
        doc.create(snapshot, (error) => {
          if (error) return reject(error);
          resolve(undefined);
        });
      });
    }

    const records = await this.calculateAndSubmitOp(
      transactionKey,
      tableId,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      createRecordsRo.fieldKeyType!,
      createRecordsRo.records.map((s, i) => ({ id: snapshots[i].record.id, fields: s.fields }))
    );

    const fieldIds = Array.from(
      records.reduce<Set<string>>((pre, cur) => {
        Object.keys(cur.record.fields).forEach((fieldId) => pre.add(fieldId));
        return pre;
      }, new Set())
    );
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const fields = await prisma.field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
      select: { id: true, name: true },
    });

    return {
      records: snapshots.map((snapshot) => {
        const record = records.find((record) => record.record.id === snapshot.record.id);
        if (record) {
          return this.convertFieldKeyInRecord(record.record, fields, createRecordsRo.fieldKeyType);
        }
        return snapshot.record;
      }),
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
    prisma: Prisma.TransactionClient,
    tableId: string,
    updateRecordByIdsRo: (UpdateRecordRo & { recordId: string })[]
  ) {
    const { fieldKeyType = FieldKeyType.Name } = updateRecordByIdsRo[0];
    const dbFieldNameSet = new Set<string>();

    const fieldMap = await this.getFieldInstanceMap(prisma, tableId, fieldKeyType);

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

    return {
      opMeta: updateRecordByIdsRo.map((updateRecordByIdRo, index) => {
        const snapshot = snapshots[index].data.record;
        const {
          record: { fields },
        } = updateRecordByIdRo;

        const setRecordOps = Object.entries(fields).map(([fieldNameOrId, value]) => {
          const field = fieldMap[fieldNameOrId];
          const oldCellValue = snapshot.fields[fieldNameOrId];
          const newCellValue = field.repair(value);
          return OpBuilder.editor.setRecord.build({
            fieldId: field.id,
            oldCellValue,
            newCellValue,
          });
        });

        return setRecordOps.length ? setRecordOps : undefined;
      }, []),
      fieldMap,
    };
  }

  private convertFieldKeyInRecord(
    record: IRecord,
    fields: { id: string; name: string }[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ) {
    if (fieldKeyType !== FieldKeyType.Id) {
      const recordFields: { [fieldName: string]: unknown } = {};
      fields.forEach((field) => {
        if (record.fields[field.id] !== undefined) {
          recordFields[field.name] = record.fields[field.id];
        }
      });

      return {
        ...record,
        fields: recordFields,
      };
    }
    return record;
  }

  async updateRecordById(
    tableId: string,
    recordId: string,
    updateRecordRo: UpdateRecordRo
  ): Promise<IRecordSnapshot> {
    return await this.transactionService.$transaction(
      this.shareDbService,
      async (prisma, transactionKey) => {
        const records = await this.calculateAndSubmitOp(
          transactionKey,
          tableId,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          updateRecordRo.fieldKeyType!,
          [{ id: recordId, fields: updateRecordRo.record.fields }]
        );

        if (records.length !== 1) {
          throw new Error('update record failed');
        }
        const fields = await prisma.field.findMany({
          where: { id: { in: Object.keys(records[0].record.fields) }, deletedTime: null },
          select: { id: true, name: true },
        });
        return {
          record: this.convertFieldKeyInRecord(
            records[0].record,
            fields,
            updateRecordRo.fieldKeyType
          ),
        };
      }
    );
  }

  async updateRecordByIndex(tableId: string, updateRecordRoByIndexRo: UpdateRecordRoByIndexRo) {
    const { viewId, index, ...updateRecordRo } = updateRecordRoByIndexRo;
    const recordId = await this.recordService.getRecordIdByIndex(tableId, viewId, index);

    return await this.updateRecordById(tableId, recordId, updateRecordRo);
  }
}
