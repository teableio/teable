import { Injectable } from '@nestjs/common';
import type {
  ICreateRecordsRo,
  ICreateRecordsVo,
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
import { isEmpty, keyBy } from 'lodash';
import type { Connection, Doc } from 'sharedb/lib/client';
import { ShareDbService } from '../../../share-db/share-db.service';
import { Timing } from '../../../utils/timing';
import { BatchService } from '../../calculation/batch.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { LinkService } from '../../calculation/link.service';
import type { ICellContext } from '../../calculation/link.service';
import type { IOpsMap } from '../../calculation/reference.service';
import { ReferenceService } from '../../calculation/reference.service';
import { formatChangesToOps } from '../../calculation/utils/changes';
import { composeMaps } from '../../calculation/utils/compose-maps';
import { RecordService } from '../record.service';

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly recordService: RecordService,
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService,
    private readonly fieldCalculationService: FieldCalculationService
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

  private async getRecordSnapshots(tableId: string, recordIds: string[]): Promise<IRecord[]> {
    const collection = `${IdPrefix.Record}_${tableId}`;
    const connection = this.shareDbService.getConnection();
    return await Promise.all(
      recordIds.map((recordId) => {
        const doc: Doc<IRecord> = connection.get(collection, recordId);
        return new Promise<IRecord>((resolve, reject) => {
          doc.fetch((err) => {
            if (err) return reject(err);
            if (!doc.data) return reject(new Error(`record ${recordId} not found`));
            return resolve(doc.data);
          });
        });
      })
    );
  }

  private async getRecordUpdateDerivation(
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

  private async calculateComputedFields(tableId: string, recordIds: string[]) {
    const fieldRaws = await this.prismaService.field.findMany({
      where: { OR: [{ tableId, isComputed: true, deletedTime: null }] },
      select: { id: true },
    });

    const computedFieldIds = fieldRaws.map((fieldRaw) => fieldRaw.id);

    // calculate by origin ops and link derivation
    const result = await this.fieldCalculationService.getChangedOpsMap(
      tableId,
      computedFieldIds,
      recordIds
    );

    if (result) {
      const { opsMap, fieldMap, tableId2DbTableName } = result;

      const rawOpMap = await this.batchService.save(
        'calculated',
        opsMap,
        fieldMap,
        tableId2DbTableName
      );

      this.shareDbService.publishOpsMap(rawOpMap);
    }
  }

  private async calculateUpdatedRecord(
    tableId: string,
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    records: { id: string; fields: { [fieldNameOrId: string]: unknown } }[]
  ) {
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
    const { opsMap, fieldMap, tableId2DbTableName } = await this.getRecordUpdateDerivation(
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

    const recordIds = plainRecords.map((r) => r.id);

    await this.calculateUpdatedRecord(tableId, fieldKeyType, plainRecords);

    await this.calculateComputedFields(tableId, recordIds);

    const records = await this.getRecordSnapshots(tableId, recordIds);

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
      await this.calculateUpdatedRecord(
        tableId,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        updateRecordRo.fieldKeyType!,
        [{ id: recordId, fields: updateRecordRo.record.fields }]
      );

      // return record result
      const records = await this.getRecordSnapshots(tableId, [recordId]);

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

  @Timing()
  private async deleteDocs(collection: string, recordIds: string[]) {
    const connection = this.shareDbService.getConnection();

    const promises = recordIds.map((recordId) => {
      const doc = connection.get(collection, recordId);
      return new Promise<void>((resolve, reject) => {
        doc.fetch((error) => {
          if (error) return reject(error);
          doc.del({}, (error) => {
            if (error) return reject(error);
            resolve(undefined);
          });
        });
      });
    });

    await Promise.all(promises);
  }

  async deleteRecord(tableId: string, recordId: string) {
    return this.deleteRecords(tableId, [recordId]);
  }

  async deleteRecords(tableId: string, recordIds: string[]) {
    return await this.prismaService.$tx(async (prisma) => {
      const linkFieldRaws = await prisma.field.findMany({
        where: {
          tableId,
          type: FieldType.Link,
          deletedTime: null,
          isLookup: null,
        },
        select: { id: true },
      });

      // reset link fields to null to clean relational data
      const recordFields = linkFieldRaws.reduce<{ [fieldId: string]: null }>((pre, cur) => {
        pre[cur.id] = null;
        return pre;
      }, {});

      await this.calculateUpdatedRecord(
        tableId,
        FieldKeyType.Id,
        recordIds.map((id) => ({
          id,
          fields: recordFields,
        }))
      );

      const collection = `${IdPrefix.Record}_${tableId}`;
      await this.deleteDocs(collection, recordIds);
    });
  }
}
