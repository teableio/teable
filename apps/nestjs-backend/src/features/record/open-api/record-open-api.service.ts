import { Injectable } from '@nestjs/common';
import type {
  IOtOperation,
  IRecord,
  IRecordSnapshot,
  ISetRecordOpContext,
} from '@teable-group/core';
import {
  OpName,
  FieldKeyType,
  IdPrefix,
  generateRecordId,
  OpBuilder,
  FieldType,
  assertNever,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Connection, Doc } from '@teable/sharedb/lib/client';
import { keyBy } from 'lodash';
import type { IFieldInstance } from '../../../features/field/model/factory';
import { createFieldInstanceByRaw } from '../../../features/field/model/factory';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { LinkService } from '../../calculation/link.service';
import type { IApplyParam, ICellContext, IOpsMap } from '../../calculation/link.service';
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

  private async generateOpsParamsByTableId(
    prisma: Prisma.TransactionClient,
    connection: Connection,
    tableId: string,
    fieldKey: FieldKeyType,
    records: { id: string; fields: { [fieldKey: string]: unknown } }[]
  ) {
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

    const applyParams: IApplyParam[] = [];
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

      Object.entries(record.fields).forEach(([fieldKey, value]) => {
        const fieldId = fieldIdMap[fieldKey].id;
        const oldCellValue = snapshot.record.fields[fieldId];
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
        opContexts,
      });
    }
    return applyParams;
  }

  private async submitOpByLinkDerivation(
    prisma: Prisma.TransactionClient,
    connection: Connection,
    tableId: string,
    applyParams: IApplyParam[]
  ) {
    // calculate all changes
    const opsMaps: IOpsMap[] = [];
    // derivate changes by link and submit it
    for (const applyParam of applyParams) {
      const recordData = applyParam.opContexts.map((ctx) => {
        return {
          id: applyParam.recordId,
          fieldId: ctx.fieldId,
          newValue: ctx.newValue,
          oldValue: ctx.oldValue,
        };
      });

      const derivateChangesByLink = await this.linkService.getDerivateChangesByLink(
        prisma,
        tableId,
        recordData as ICellContext[]
      );
      opsMaps.push(
        this.linkService.formatOpsByChanges(
          recordData
            .map((data) => {
              return {
                tableId,
                recordId: data.id,
                fieldId: data.fieldId,
                newValue: data.newValue,
                oldValue: data.oldValue,
              };
            })
            .concat(derivateChangesByLink)
        )
      );
    }

    const opsMap = this.linkService.composeOpsMaps(opsMaps);
    await this.sendOpsMap(connection, opsMap);
    return opsMap;
  }

  private async submitOpByCalculation(
    prisma: Prisma.TransactionClient,
    connection: Connection,
    opsMap: IOpsMap
  ) {
    const calculated = await this.linkService.calculate(prisma, opsMap);

    opsMap = this.linkService.formatOpsByChanges(calculated);

    // submit other changes
    await this.sendOpsMap(connection, opsMap);
  }

  private async getRecordSnapshotsAfterSubmit(
    connection: Connection,
    tableId: string,
    records: { id: string; fields: { [fieldKey: string]: unknown } }[]
  ): Promise<IRecordSnapshot[]> {
    const collection = `${IdPrefix.Record}_${tableId}`;
    return records.map((record) => {
      const doc: Doc<IRecordSnapshot> = connection.get(collection, record.id);
      if (!doc.data) {
        throw new Error(`record ${record.id} not found`);
      }
      return doc.data;
    });
  }

  private async calculateAndSubmitOp(
    transactionKey: string,
    tableId: string,
    fieldKey: FieldKeyType = FieldKeyType.Name,
    records: { id: string; fields: { [fieldKey: string]: unknown } }[]
  ): Promise<IRecordSnapshot[]> {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const connection = this.shareDbService.getConnection(transactionKey);

    // generate Op by origin submit
    const originApplyParams = await this.generateOpsParamsByTableId(
      prisma,
      connection,
      tableId,
      fieldKey,
      records
    );

    // console.log('generateOpsParamsByTableId', JSON.stringify(originApplyParams, null, 2));
    // apply op by origin submit and link derivation
    const opsMap = await this.submitOpByLinkDerivation(
      prisma,
      connection,
      tableId,
      originApplyParams
    );

    // console.log('submitOpByLinkDerivation', JSON.stringify(opsMap, null, 2));

    // apply op by calculate derivation
    await this.submitOpByCalculation(prisma, connection, opsMap);

    // return record result
    return this.getRecordSnapshotsAfterSubmit(connection, tableId, records);
  }

  private async prepareDoc(doc: Doc) {
    if (doc.data) {
      return doc;
    }
    return new Promise<Doc>((resolve, reject) => {
      doc.fetch((err) => {
        if (err) return reject(err);
        resolve(doc);
      });
    });
  }

  private async sendOpsMap(
    connection: Connection,
    opsMapByTableId: { [tableId: string]: { [recordId: string]: IOtOperation[] } }
  ) {
    console.log('sendOpsAfterApply:', JSON.stringify(opsMapByTableId, null, 2));
    for (const tableId in opsMapByTableId) {
      const data = opsMapByTableId[tableId];
      const collection = `${IdPrefix.Record}_${tableId}`;
      for (const recordId in data) {
        const ops = data[recordId];
        const doc = connection.get(collection, recordId);
        await this.submitOps(doc, ops);
      }
    }
  }

  private async sendAutoFillOps(
    transactionKey: string,
    tableId: string,
    records: { id: string; fields: { [fieldKey: string]: unknown } }[],
    fieldKey: FieldKeyType
  ) {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const fieldRaws = await prisma.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, name: true, type: true, options: true },
    });

    return records.map((record) => {
      const fields: { [fieldIdOrName: string]: unknown } = { ...record.fields };
      for (const fieldRaw of fieldRaws) {
        const { type, options } = fieldRaw;
        if (options == null) continue;
        const { autoFill, defaultValue: _defaultValue } = JSON.parse(options) || {};
        const fieldIdOrName = fieldRaw[fieldKey];
        if (fields[fieldIdOrName] != null || !autoFill) continue;
        fields[fieldIdOrName] = this.getDefaultValue(type as FieldType, _defaultValue);
      }

      return {
        ...record,
        fields,
      };
    });
  }

  private getDefaultValue(type: FieldType, defaultValue: unknown) {
    switch (type) {
      case FieldType.Date:
        return new Date().toISOString();
      case FieldType.SingleLineText:
      case FieldType.LongText:
      case FieldType.Number:
      case FieldType.Percent:
      case FieldType.Currency: {
        return defaultValue;
      }
      default:
        assertNever(type as never);
    }
  }

  private async submitOps<T>(doc: Doc<T>, ops: IOtOperation[]): Promise<T> {
    await this.prepareDoc(doc);
    return await new Promise((resolve, reject) => {
      doc.submitOp(ops, undefined, (error) => {
        if (error) {
          return reject(error);
        }
        resolve(doc.data);
      });
    });
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

    // submit auto fill changes
    const filledRecords = await this.sendAutoFillOps(
      transactionKey,
      tableId,
      createRecordsRo.records.map((s, i) => ({ id: snapshots[i].record.id, fields: s.fields })),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      createRecordsRo.fieldKeyType!
    );

    const records = await this.calculateAndSubmitOp(
      transactionKey,
      tableId,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      createRecordsRo.fieldKeyType!,
      filledRecords
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
