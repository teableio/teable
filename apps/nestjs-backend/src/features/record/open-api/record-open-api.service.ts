import { Injectable } from '@nestjs/common';
import type {
  ICreateRecordsRo,
  ICreateRecordsVo,
  IOtOperation,
  IRecord,
  IUpdateRecordByIndexRo,
  IUpdateRecordRo,
} from '@teable-group/core';
import {
  FieldKeyType,
  IdPrefix,
  generateRecordId,
  RecordOpBuilder,
  FieldType,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { Connection, Doc } from '@teable/sharedb/lib/client';
import { isEmpty, keyBy } from 'lodash';
import { ShareDbService } from '../../../share-db/share-db.service';
import { BatchService } from '../../calculation/batch.service';
import { LinkService } from '../../calculation/link.service';
import type { ICellContext } from '../../calculation/link.service';
import type { IOpsMap } from '../../calculation/reference.service';
import { ReferenceService } from '../../calculation/reference.service';
import { formatChangesToOps } from '../../calculation/utils/changes';
import { composeMaps } from '../../calculation/utils/compose-maps';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import type { IFieldInstance } from '../../field/model/factory';
import { RecordService } from '../record.service';

interface ICreateRecordOpMeta {
  snapshot: IRecord;
  ops?: IOtOperation[];
}

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly recordService: RecordService,
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService
  ) {}

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo
  ): Promise<ICreateRecordsVo> {
    return await this.prismaService.$tx(async () => {
      return await this.createRecords(
        tableId,
        createRecordsRo.records,
        createRecordsRo.fieldKeyType
      );
    });
  }

  private async generateCellContexts(
    connection: Connection,
    tableId: string,
    fieldKeyType: FieldKeyType,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[]
  ) {
    const fieldKeys = Array.from(
      records.reduce<Set<string>>((acc, record) => {
        Object.keys(record.fields).forEach((fieldNameOrId) => acc.add(fieldNameOrId));
        return acc;
      }, new Set())
    );

    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, [fieldKeyType]: { in: fieldKeys } },
      select: { id: true, name: true },
    });
    const fieldIdMap = keyBy(fieldRaws, fieldKeyType);

    const cellContexts: ICellContext[] = [];
    for (const record of records) {
      const collection = `${IdPrefix.Record}_${tableId}`;
      const doc = connection.get(collection, record.id);
      const snapshot = await new Promise<IRecord>((resolve, reject) => {
        doc.fetch((err) => {
          if (err) return reject(err);
          resolve(doc.data);
        });
      });
      Object.entries(record.fields).forEach(([fieldNameOrId, value]) => {
        const fieldId = fieldIdMap[fieldNameOrId].id;
        const oldCellValue = snapshot.fields[fieldId];
        cellContexts.push({
          recordId: record.id,
          fieldId,
          newValue: value,
          oldValue: oldCellValue,
        });
      });
    }
    return cellContexts;
  }

  private async getRecordSnapshotsAfterSubmit(
    tableId: string,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[]
  ): Promise<IRecord[]> {
    const collection = `${IdPrefix.Record}_${tableId}`;
    const connection = this.shareDbService.getConnection();
    return await Promise.all(
      records.map((record) => {
        const doc: Doc<IRecord> = connection.get(collection, record.id);
        return new Promise<IRecord>((resolve, reject) => {
          doc.fetch((err) => {
            if (err) return reject(err);
            if (!doc.data) return reject(new Error(`record ${record.id} not found`));
            return resolve(doc.data);
          });
        });
      })
    );
  }

  private async getOpsMapByDerivation(
    tableId: string,
    opsMapOrigin: IOpsMap,
    opContexts: ICellContext[]
  ) {
    const derivate = await this.linkService.getDerivateByLink(tableId, opContexts);

    const cellChanges = derivate?.cellChanges || [];
    const fkRecordMap = derivate?.fkRecordMap || {};

    const opsMapByLink = cellChanges.length ? formatChangesToOps(cellChanges) : {};
    // calculate by origin ops and link derivation
    const {
      opsMap: opsMapByCalculation,
      fieldMap,
      tableId2DbTableName,
    } = await this.referenceService.calculateOpsMap(
      composeMaps([opsMapOrigin, opsMapByLink]),
      fkRecordMap
    );

    return {
      opsMap: composeMaps([opsMapOrigin, opsMapByLink, opsMapByCalculation]),
      fieldMap,
      tableId2DbTableName,
    };
  }

  private async calculateAndSubmitOp(
    tableId: string,
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[]
  ): Promise<IRecord[]> {
    const connection = this.shareDbService.getConnection();

    // 1. generate Op by origin submit
    const opsContexts = await this.generateCellContexts(connection, tableId, fieldKeyType, records);

    const opsMapOrigin = formatChangesToOps(
      opsContexts.map((data) => {
        return {
          tableId,
          recordId: data.recordId,
          fieldId: data.fieldId,
          newValue: data.newValue,
          oldValue: data.oldValue,
        };
      })
    );

    // 2. get cell changes by derivation
    const { opsMap, fieldMap, tableId2DbTableName } = await this.getOpsMapByDerivation(
      tableId,
      opsMapOrigin,
      opsContexts
    );

    // 3. save all ops
    if (!isEmpty(opsMap)) {
      const rawOpMap = await this.batchService.save(
        'calculated',
        opsMap,
        fieldMap,
        tableId2DbTableName
      );

      // 4. send all ops
      this.shareDbService.publishOpsMap(rawOpMap);
    }

    // return record result
    return this.getRecordSnapshotsAfterSubmit(tableId, records);
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

  private async appendDefaultValue(
    tableId: string,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[],
    fieldKeyType: FieldKeyType
  ) {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, name: true, type: true, options: true },
    });

    return records.map((record) => {
      const fields: { [fieldIdOrName: string]: unknown } = { ...record.fields };
      for (const fieldRaw of fieldRaws) {
        const { type, options } = fieldRaw;
        if (options == null) continue;
        const { defaultValue } = JSON.parse(options) || {};
        if (defaultValue == null) continue;
        const fieldIdOrName = fieldRaw[fieldKeyType];
        if (fields[fieldIdOrName] != null) continue;
        fields[fieldIdOrName] = this.getDefaultValue(type as FieldType, defaultValue);
      }

      return {
        ...record,
        fields,
      };
    });
  }

  private getDefaultValue(type: FieldType, defaultValue: unknown) {
    if (type === FieldType.Date && defaultValue === 'now') {
      return new Date().toISOString();
    }
    return defaultValue;
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

  async createRecords(
    tableId: string,
    recordsRo: { id?: string; fields: Record<string, unknown> }[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name
  ): Promise<ICreateRecordsVo> {
    const snapshots = recordsRo.map((record) => {
      const recordId = record.id || generateRecordId();
      return RecordOpBuilder.creator.build({ id: recordId, fields: {}, recordOrder: {} });
    });

    const connection = this.shareDbService.getConnection();

    for (const snapshot of snapshots) {
      const collection = `${IdPrefix.Record}_${tableId}`;
      const docId = snapshot.id;
      const doc = connection.get(collection, docId);
      await new Promise<void>((resolve, reject) => {
        doc.create(snapshot, (error) => {
          if (error) return reject(error);
          resolve(undefined);
        });
      });
    }

    // submit auto fill changes
    const plainRecords = await this.appendDefaultValue(
      tableId,
      recordsRo.map((s, i) => ({ id: snapshots[i].id, fields: s.fields })),
      fieldKeyType
    );

    const records = await this.calculateAndSubmitOp(tableId, fieldKeyType, plainRecords);

    const fieldIds = Array.from(
      records.reduce<Set<string>>((pre, cur) => {
        Object.keys(cur.fields).forEach((fieldId) => pre.add(fieldId));
        return pre;
      }, new Set())
    );
    const fields = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
      select: { id: true, name: true },
    });

    return {
      records: snapshots.map((snapshot) => {
        const record = records.find((record) => record.id === snapshot.id);
        if (record) {
          return this.convertFieldKeyInRecord(record, fields, fieldKeyType);
        }
        return snapshot;
      }),
    };
  }

  private async getFieldInstanceMap(tableId: string, fieldKeyType: FieldKeyType | undefined) {
    const allFields = await this.prismaService.txClient().field.findMany({
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
    createRecordsDto: ICreateRecordsRo
  ): ICreateRecordOpMeta[] {
    return createRecordsDto.records.map<ICreateRecordOpMeta>((record) => {
      const recordId = generateRecordId();
      const snapshot = RecordOpBuilder.creator.build({
        id: recordId,
        fields: {},
        recordOrder: {},
      });

      const setRecordOps = Object.entries(record.fields).map(([fieldNameOrId, value]) => {
        const field = fieldName2IdMap[fieldNameOrId];
        const newCellValue = field.repair(value);

        return RecordOpBuilder.editor.setRecord.build({
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
    updateRecordByIdsRo: (IUpdateRecordRo & { recordId: string })[]
  ) {
    const { fieldKeyType = FieldKeyType.Name } = updateRecordByIdsRo[0];
    const dbFieldNameSet = new Set<string>();

    const fieldMap = await this.getFieldInstanceMap(tableId, fieldKeyType);

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
      tableId,
      recordIds,
      projection,
      fieldKeyType
    );

    return {
      opMeta: updateRecordByIdsRo.map((updateRecordByIdRo, index) => {
        const snapshot = snapshots[index].data;
        const {
          record: { fields },
        } = updateRecordByIdRo;

        const setRecordOps = Object.entries(fields).map(([fieldNameOrId, value]) => {
          const field = fieldMap[fieldNameOrId];
          const oldCellValue = snapshot.fields[fieldNameOrId];
          const newCellValue = field.repair(value);
          return RecordOpBuilder.editor.setRecord.build({
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

  async updateRecords(
    tableId: string,
    updateRecordsRo: (IUpdateRecordRo & { recordId: string })[]
  ) {
    return await this.prismaService.$tx(async () => {
      for (const { recordId, ...updateRecordRo } of updateRecordsRo) {
        await this.updateRecordById(tableId, recordId, updateRecordRo);
      }
    });
  }

  async updateRecordById(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo
  ): Promise<IRecord> {
    return await this.prismaService.$tx(async (prisma) => {
      const records = await this.calculateAndSubmitOp(
        tableId,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        updateRecordRo.fieldKeyType!,
        [{ id: recordId, fields: updateRecordRo.record.fields }]
      );

      if (records.length !== 1) {
        throw new Error('update record failed');
      }
      const fields = await prisma.field.findMany({
        where: { id: { in: Object.keys(records[0].fields) }, deletedTime: null },
        select: { id: true, name: true },
      });
      return this.convertFieldKeyInRecord(records[0], fields, updateRecordRo.fieldKeyType);
    });
  }

  async updateRecordByIndex(tableId: string, updateRecordRoByIndexRo: IUpdateRecordByIndexRo) {
    const { viewId, index, ...updateRecordRo } = updateRecordRoByIndexRo;
    const recordId = await this.recordService.getRecordIdByIndex(tableId, viewId, index);

    return await this.updateRecordById(tableId, recordId, updateRecordRo);
  }
}
