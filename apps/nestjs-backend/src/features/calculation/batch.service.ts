/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import { HttpErrorCode, IdPrefix, RecordOpBuilder, FieldType } from '@teable/core';
import type { IOtOperation, IRecord, TableDomain } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { groupBy, isEmpty, keyBy } from 'lodash';
import { customAlphabet } from 'nanoid';
import { InjectModel } from 'nest-knexjs';
import { bufferCount, concatMap, from, lastValueFrom } from 'rxjs';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { DatabaseRouter } from '../../global/database-router.service';
import type { IDataPrismaQueryExecutor } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex/knex.module';
import { RawOpType } from '../../share-db/interface';
import { RawOpStagingService } from '../../share-db/raw-op-staging.service';
import { V1EngineService } from '../../tracing/decorators/v1-engine';
import type { IOpsMap } from '../../types/ops-map';
import { handleDBValidationErrors } from '../../utils/db-validation-error';
import { Timing } from '../../utils/timing';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw, fieldCore2FieldInstance } from '../field/model/factory';
import { dbType2knexFormat, SchemaType } from '../field/util';
import { RecordQueryService } from '../record/record-query.service';
import { TableDomainQueryService } from '../table-domain/table-domain-query.service';

const LAST_MODIFIED_ACTOR_COLUMNS = [
  '__last_modified_by_actor_type',
  '__last_modified_by_actor_id',
] as const;

export interface IOpsData {
  recordId: string;
  updateParam: {
    [dbFieldName: string]: unknown;
  };
  version: number;
}

@Injectable()
@V1EngineService(['updateRecords', 'batchUpdateDB'])
export class BatchService {
  private readonly logger = new Logger(BatchService.name);
  constructor(
    private readonly rawOpStagingService: RawOpStagingService,
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly recordQueryService: RecordQueryService,
    private readonly tableDomainQueryService: TableDomainQueryService,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  private async completeMissingCtx(
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance } = {},
    tableId2DbTableName: { [tableId: string]: string } = {}
  ) {
    const tableIds = Object.keys(opsMap);

    const missingFieldIds = Array.from(
      tableIds.reduce<Set<string>>((pre, id) => {
        Object.values(opsMap[id]).forEach((ops) =>
          ops.forEach((op) => {
            const fieldId = RecordOpBuilder.editor.setRecord.detect(op)?.fieldId;
            if (fieldId) {
              pre.add(fieldId);
            }
          })
        );
        return pre;
      }, new Set())
    );

    if (!missingFieldIds.length) {
      return { fieldMap, tableId2DbTableName };
    }

    const tableRaw = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: tableIds }, deletedTime: null },
      select: { id: true, dbTableName: true },
    });

    const fieldsRaw = await this.prismaService.txClient().field.findMany({
      where: { id: { in: missingFieldIds }, deletedTime: null },
    });

    const fields = fieldsRaw.map(createFieldInstanceByRaw);

    const extraFieldsMap = keyBy(fields, 'id');

    const extraTableId2DbTableName = tableRaw.reduce<{ [tableId: string]: string }>(
      (pre, { id, dbTableName }) => {
        pre[id] = dbTableName;
        return pre;
      },
      {}
    );

    return {
      tableId2DbTableName: { ...tableId2DbTableName, ...extraTableId2DbTableName },
      fieldMap: { ...fieldMap, ...extraFieldsMap },
    };
  }

  private async updateRecordsTask(
    tableId: string,
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsPair: [recordId: string, IOtOperation[]][]
  ) {
    return this.databaseRouter.dataPrismaTransactionForTable(
      tableId,
      async (tx) => {
        const raw = await this.fetchRawData(
          dbTableName,
          opsPair.map(([recordId]) => recordId),
          tx
        );
        const versionGroup = keyBy(raw, '__id');

        opsPair.forEach(([recordId]) => {
          if (!versionGroup[recordId]) {
            throw new CustomHttpException(
              `Record ${recordId} not found in ${tableId}`,
              HttpErrorCode.VALIDATION_ERROR,
              {
                localization: {
                  i18nKey: 'httpErrors.field.recordNotFound',
                  context: {
                    recordId,
                    tableId,
                  },
                },
              }
            );
          }
        });

        const opsData = this.buildRecordOpsData(opsPair, versionGroup);
        if (!opsData.length) return;
        await this.executeUpdateRecords(tableId, dbTableName, fieldMap, opsData, tx);

        const opDataList = opsPair.map(([recordId, ops]) => {
          return { docId: recordId, version: versionGroup[recordId].__version, data: ops };
        });

        const rawOps = this.rawOpStagingService.saveRawOps(
          tableId,
          RawOpType.Edit,
          IdPrefix.Record,
          opDataList,
          { publish: false }
        );
        await this.eventEmitterService.persistRecordHistory([rawOps], (sql) =>
          tx.$executeRawUnsafe(sql)
        );
        this.rawOpStagingService.publishRawOps(rawOps);
      },
      undefined,
      { useTransaction: true }
    );
  }

  @Timing()
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async updateRecords(
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance } = {},
    tableId2DbTableName: { [tableId: string]: string } = {},
    tableDomains?: Map<string, TableDomain>
  ): Promise<{ [tableId: string]: { [recordId: string]: IRecord } }> {
    const execute = async () => {
      const prepared = await this.prepareUpdateRecordsContext(
        opsMap,
        fieldMap,
        tableId2DbTableName,
        tableDomains
      );
      const domainCache = prepared.domainCache;
      fieldMap = prepared.fieldMap;
      tableId2DbTableName = prepared.tableId2DbTableName;

      // Get old records before updating
      const oldRecords: { [tableId: string]: { [recordId: string]: IRecord } } = {};

      for (const tableId in opsMap) {
        const recordIds = Object.keys(opsMap[tableId]);
        if (recordIds.length === 0) continue;

        try {
          const domain = domainCache.get(tableId);
          if (!domain) {
            this.logger.warn(`TableDomain not found for table ${tableId}, skip snapshot read`);
            oldRecords[tableId] = {};
            continue;
          }
          const snapshots = await this.recordQueryService.getSnapshotBulk(domain, recordIds);
          oldRecords[tableId] = {};
          for (const snapshot of snapshots) {
            oldRecords[tableId][snapshot.id] = snapshot.data;
          }
        } catch (error) {
          this.logger.warn(`Failed to get old records for table ${tableId}: ${error}`);
          oldRecords[tableId] = {};
        }
      }

      // Perform the actual updates
      for (const tableId in opsMap) {
        const dbTableName = tableId2DbTableName[tableId];
        const recordOpsMap = opsMap[tableId];
        if (isEmpty(recordOpsMap)) {
          continue;
        }
        const opsPair = Object.entries(recordOpsMap);
        const taskFunction = async (opp: [recordId: string, IOtOperation[]][]) =>
          this.updateRecordsTask(tableId, dbTableName, fieldMap, opp);

        await lastValueFrom(
          from(opsPair).pipe(
            bufferCount(this.thresholdConfig.calcChunkSize),
            concatMap((opsPair) => from(taskFunction(opsPair)))
          )
        );
      }

      return oldRecords;
    };
    // v1 no longer attributes writes, so a batch update takes no schema lease: a link-field write
    // reaches tables that are not part of this batch, and locking them would refuse the write.
    return execute();
  }

  private async prepareUpdateRecordsContext(
    opsMap: IOpsMap,
    fieldMap: { [fieldId: string]: IFieldInstance },
    tableId2DbTableName: { [tableId: string]: string },
    tableDomains?: Map<string, TableDomain>
  ) {
    const tableIds = Object.keys(opsMap);
    const domainCache = new Map<string, TableDomain>(tableDomains || []);
    const missingDomainIds = tableIds.filter((id) => !domainCache.has(id));
    if (missingDomainIds.length) {
      const fetched = await this.tableDomainQueryService.getTableDomainsByIds(missingDomainIds);
      for (const [tid, domain] of fetched) {
        domainCache.set(tid, domain);
      }
    }
    // Prefill table/db mapping and field instances from domains to reduce follow-up lookups
    for (const [tid, domain] of domainCache) {
      tableId2DbTableName[tid] ||= domain.dbTableName;
      for (const field of domain.fieldList) {
        if (!fieldMap[field.id]) {
          fieldMap[field.id] = fieldCore2FieldInstance(field);
        }
      }
    }
    const result = await this.completeMissingCtx(opsMap, fieldMap, tableId2DbTableName);
    return {
      domainCache,
      fieldMap: result.fieldMap,
      tableId2DbTableName: result.tableId2DbTableName,
    };
  }

  // @Timing()
  private async fetchRawData(
    dbTableName: string,
    recordIds: string[],
    executor: IDataPrismaQueryExecutor
  ) {
    const querySql = this.knex(dbTableName)
      .whereIn('__id', recordIds)
      .select('__id', '__version', '__last_modified_time', '__last_modified_by')
      .toQuery();

    return executor.$queryRawUnsafe<{ __version: number; __id: string }[]>(querySql);
  }

  private buildRecordOpsData(
    opsPair: [recordId: string, IOtOperation[]][],
    versionGroup: {
      [recordId: string]: {
        __version: number;
        __id: string;
      };
    }
  ) {
    const opsData: IOpsData[] = [];

    for (const [recordId, ops] of opsPair) {
      const updateParam = ops.reduce<{ [fieldId: string]: unknown }>((pre, op) => {
        const opContext = RecordOpBuilder.editor.setRecord.detect(op);
        if (
          !opContext ||
          LAST_MODIFIED_ACTOR_COLUMNS.some((column) => column === opContext.fieldId)
        ) {
          throw new CustomHttpException(
            `illegal op ${JSON.stringify(op)} found when build record ops data`,
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.custom.invalidOperation',
              },
            }
          );
        }
        pre[opContext.fieldId] = opContext.newCellValue;
        return pre;
      }, {});

      const version = versionGroup[recordId].__version;

      opsData.push({
        recordId,
        version,
        updateParam,
      });
    }

    return opsData;
  }

  @Timing()
  private async executeUpdateRecords(
    tableId: string,
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsData: IOpsData[],
    executor: IDataPrismaQueryExecutor
  ) {
    if (!opsData.length) return;

    const opsDataGroup = groupBy(opsData, (d) => {
      return Object.keys(d.updateParam).join();
    });

    // group by fieldIds before apply
    for (const groupKey in opsDataGroup) {
      await this.executeUpdateRecordsInner(
        tableId,
        dbTableName,
        fieldMap,
        opsDataGroup[groupKey],
        executor
      );
    }
  }

  async batchUpdateDB(
    dbTableName: string,
    idFieldName: string,
    schemas: { schemaType: SchemaType; dbFieldName: string }[],
    data: { id: string; values: { [key: string]: unknown } }[],
    routingTableId?: string,
    executor?: IDataPrismaQueryExecutor
  ) {
    const tempTableName = `temp_` + customAlphabet('abcdefghijklmnopqrstuvwxyz', 10)();
    // 1.create temporary table structure
    const createTempTableSchema = this.knex.schema.createTable(tempTableName, (table) => {
      table.string(idFieldName).primary();
      schemas.forEach(({ dbFieldName, schemaType }) => {
        table[schemaType](dbFieldName);
      });
    });

    const createTempTableSql = createTempTableSchema
      .toQuery()
      .replace('create table', 'create temporary table');

    const { insertTempTableSql, updateRecordSql } = this.dbProvider.executeUpdateRecordsSqlList({
      dbTableName,
      tempTableName,
      idFieldName,
      dbFieldNames: schemas.map((s) => s.dbFieldName),
      data,
    });
    const dropTempTableSql = this.knex.schema.dropTable(tempTableName).toQuery();

    const validDbFieldNames = schemas.map((s) => s.dbFieldName).filter((f) => !f.startsWith('__'));

    const execute = async (tx: IDataPrismaQueryExecutor) => {
      // temp table should in one transaction
      await tx.$executeRawUnsafe(createTempTableSql);
      // 2.initialize temporary table data
      await tx.$executeRawUnsafe(insertTempTableSql);
      // 3.update data
      await handleDBValidationErrors({
        fn: async () => {
          await tx.$executeRawUnsafe(updateRecordSql);
        },
        handleUniqueError: async () => {
          const tables = await this.prismaService.tableMeta.findMany({
            where: { dbTableName },
            select: { id: true, name: true },
          });
          const table = tables[0];
          const fieldRaws = await this.prismaService.field.findMany({
            where: {
              tableId: table.id,
              dbFieldName: { in: validDbFieldNames },
              unique: true,
              deletedTime: null,
            },
            select: { id: true, name: true },
          });

          throw new CustomHttpException(
            `Fields ${fieldRaws.map((f) => f.id).join(', ')} unique validation failed`,
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.custom.fieldValueDuplicate',
                context: {
                  tableName: table.name,
                  fieldName: fieldRaws.map((f) => f.name).join(', '),
                },
              },
            }
          );
        },
        handleNotNullError: async () => {
          const tables = await this.prismaService.tableMeta.findMany({
            where: { dbTableName },
            select: { id: true, name: true },
          });
          const table = tables[0];
          const fieldRaws = await this.prismaService.field.findMany({
            where: {
              tableId: table.id,
              dbFieldName: { in: validDbFieldNames },
              notNull: true,
              deletedTime: null,
            },
            select: { id: true, name: true },
          });

          throw new CustomHttpException(
            `Fields ${fieldRaws.map((f) => f.id).join(', ')} not null validation failed`,
            HttpErrorCode.VALIDATION_ERROR,
            {
              localization: {
                i18nKey: 'httpErrors.custom.fieldValueNotNull',
                context: {
                  tableName: table.name,
                  fieldName: fieldRaws.map((f) => f.name).join(', '),
                },
              },
            }
          );
        },
      });
      // 4.delete temporary table
      await tx.$executeRawUnsafe(dropTempTableSql);
    };
    if (executor) return execute(executor);

    const resolvedRoutingTableId =
      routingTableId ??
      (
        await this.prismaService.txClient().tableMeta.findFirstOrThrow({
          where: { dbTableName, deletedTime: null },
          select: { id: true },
        })
      ).id;
    return this.databaseRouter.dataPrismaTransactionForTable(
      resolvedRoutingTableId,
      execute,
      undefined,
      { useTransaction: true }
    );
  }

  private async executeUpdateRecordsInner(
    tableId: string,
    dbTableName: string,
    fieldMap: { [fieldId: string]: IFieldInstance },
    opsData: IOpsData[],
    executor: IDataPrismaQueryExecutor
  ) {
    if (!opsData.length) {
      return;
    }

    const fieldIds = Array.from(new Set(opsData.flatMap((d) => Object.keys(d.updateParam))))
      .filter((id) => fieldMap[id])
      .filter((id) => !fieldMap[id].isComputed)
      .filter((id) => fieldMap[id].type !== FieldType.Link);
    const data = opsData.map((data) => {
      const { recordId, updateParam, version } = data;

      return {
        id: recordId,
        values: {
          ...Object.entries(updateParam).reduce<{ [dbFieldName: string]: unknown }>(
            (pre, [fieldId, value]) => {
              const field = fieldMap[fieldId];
              if (!field) {
                return pre;
              }
              if (field.isComputed || field.type === FieldType.Link) {
                return pre;
              }
              const { dbFieldName } = field;
              pre[dbFieldName] = field.convertCellValue2DBValue(value);
              return pre;
            },
            {}
          ),
          __version: version + 1,
        },
      };
    });

    const schemas = [
      ...fieldIds.map((id) => {
        const { dbFieldName, dbFieldType } = fieldMap[id];
        return { dbFieldName, schemaType: dbType2knexFormat(this.knex, dbFieldType) };
      }),
      { dbFieldName: '__version', schemaType: SchemaType.Integer },
    ];

    await this.batchUpdateDB(dbTableName, '__id', schemas, data, tableId, executor);
  }
}
