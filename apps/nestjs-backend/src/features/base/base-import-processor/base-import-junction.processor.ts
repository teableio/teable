/* eslint-disable @typescript-eslint/naming-convention */
import { finished, pipeline } from 'node:stream/promises';
import { InjectQueue, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import * as csvParser from 'csv-parser';
import type { Knex } from 'knex';
import { ClsService } from 'nestjs-cls';
import * as unzipper from 'unzipper';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { postgresAddForeignKeyNotValidSql } from '../../../db-provider/postgres-fk-delete-action';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { IClsStore } from '../../../types/cls';
import { Processor } from '../../../utils/queue-processor';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import type { LinkFieldDto } from '../../field/model/field-dto/link-field.dto';
import { NotificationService } from '../../notification/notification.service';
import { PersistedComputedBackfillService } from '../../record/computed/services/persisted-computed-backfill.service';
import { BaseImportComputedService } from '../base-import-computed.service';
import { notifyBaseImportFailure, notifyBaseImportWarnings } from '../base-import-warnings';
import { BatchProcessor } from '../BatchProcessor.class';

type IDataPrismaExecutor = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

type IDataPrismaScopedClient = IDataPrismaExecutor & {
  $tx?: <T>(fn: (prisma: IDataPrismaExecutor) => Promise<T>) => Promise<T>;
  $transaction?: <T>(fn: (prisma: IDataPrismaExecutor) => Promise<T>) => Promise<T>;
};

interface IBaseImportJunctionCsvJob {
  path: string;
  userId: string;
  baseId: string;
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
  structure: IBaseJson;
}

interface IImportedLink {
  sourceTableId: string;
  sourceDbFieldName: string;
  sourceOptions: ILinkFieldOptions;
  field: LinkFieldDto;
  dbTableName: string;
  foreignDbTableName: string;
  isJunction: boolean;
}

type IImportedTable = { id: string; baseId: string; dbTableName: string };
type IImportedLinkField = { tableId: string; field: LinkFieldDto };

export const BASE_IMPORT_JUNCTION_CSV_QUEUE = 'base-import-junction-csv-queue';

@Injectable()
@Processor(BASE_IMPORT_JUNCTION_CSV_QUEUE)
export class BaseImportJunctionCsvQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(BaseImportJunctionCsvQueueProcessor.name);
  private readonly processedJobs = new Set<string>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly persistedComputedBackfillService: PersistedComputedBackfillService,
    private readonly baseImportComputedService: BaseImportComputedService,
    private readonly cls: ClsService<IClsStore>,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE)
    public readonly queue: Queue<IBaseImportJunctionCsvJob>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly notificationService: NotificationService
  ) {
    super();
  }

  public async process(job: Job<IBaseImportJunctionCsvJob>) {
    const jobId = String(job.id);
    if (this.processedJobs.has(jobId)) {
      this.logger.log(`Job ${jobId} already processed, skipping`);
      return;
    }

    this.processedJobs.add(jobId);

    const { path, baseId, userId, tableIdMap, fieldIdMap, structure } = job.data;

    try {
      const base = await this.prismaService.base.findUniqueOrThrow({
        where: { id: baseId },
        select: { v2Enabled: true },
      });
      await this.cls.run(async () => {
        this.cls.set('user.id', userId);
        const links = await this.getImportedLinks(baseId, tableIdMap, fieldIdMap, structure);
        const fallback = await this.importJunctionChunk(path, baseId, links);
        const skippedLinkCells =
          fallback.skippedCells +
          (await this.clearDanglingLinks(baseId, links, fallback.junctions));
        await (
          base.v2Enabled ? this.baseImportComputedService : this.persistedComputedBackfillService
        ).recomputeForTables(Object.values(tableIdMap));
        await notifyBaseImportWarnings(this.notificationService, baseId, userId, {
          skippedUserCells: 0,
          skippedLinkCells,
          relaxedRequiredUserFields: 0,
        });
      });
    } catch (error) {
      this.processedJobs.delete(jobId);
      this.logger.error(
        `Base import relationship restoration failed: ${(error as Error)?.message}`,
        (error as Error)?.stack
      );
      try {
        await notifyBaseImportFailure(this.notificationService, baseId, userId);
      } catch {
        this.logger.error('Base import relationship failure notification failed');
      }
      // Queue failure details are user-visible too: never expose SQL or imported values.
      throw new Error('Base import relationship restoration failed');
    }
  }

  private async getImportedLinks(
    baseId: string,
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    structure: IBaseJson
  ): Promise<IImportedLink[]> {
    const raws = await this.prismaService.field.findMany({
      where: {
        id: { in: Object.values(fieldIdMap) },
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
    });
    const fields = new Map<string, IImportedLinkField>(
      raws.map((raw) => [
        raw.id,
        { tableId: raw.tableId, field: createFieldInstanceByRaw(raw) as LinkFieldDto },
      ])
    );
    const tables = await this.prismaService.tableMeta.findMany({
      where: {
        id: {
          in: [
            ...Object.values(tableIdMap),
            ...[...fields.values()].map(({ field }) => field.options.foreignTableId),
          ],
        },
        deletedTime: null,
      },
      select: { id: true, baseId: true, dbTableName: true },
    });
    const tableMap = new Map(tables.map((table) => [table.id, table]));
    const links: IImportedLink[] = [];
    for (const sourceTable of structure.tables) {
      for (const sourceField of sourceTable.fields) {
        if (sourceField.type !== FieldType.Link || sourceField.isLookup) continue;
        links.push(
          this.mapImportedLink(
            baseId,
            sourceTable.id,
            sourceField,
            fields.get(fieldIdMap[sourceField.id]),
            tableMap.get(tableIdMap[sourceTable.id]),
            tableMap
          )
        );
      }
    }
    return links;
  }

  private mapImportedLink(
    baseId: string,
    sourceTableId: string,
    sourceField: IBaseJson['tables'][number]['fields'][number],
    targetField: IImportedLinkField | undefined,
    table: IImportedTable | undefined,
    tables: Map<string, IImportedTable>
  ): IImportedLink {
    const field = targetField?.field;
    const foreignTable = field && tables.get(field.options.foreignTableId);
    if (!targetField || !field || !table || !foreignTable) {
      throw new Error('Invalid imported relationship metadata');
    }
    if (
      targetField.tableId !== table.id ||
      table.baseId !== baseId ||
      foreignTable.baseId !== baseId
    ) {
      throw new Error('Invalid imported relationship metadata');
    }
    return {
      sourceTableId,
      sourceDbFieldName: sourceField.dbFieldName,
      sourceOptions: sourceField.options as ILinkFieldOptions,
      field,
      dbTableName: table.dbTableName,
      foreignDbTableName: foreignTable.dbTableName,
      isJunction: this.validateLinkStorage(field, table.dbTableName, foreignTable.dbTableName),
    };
  }

  private validateLinkStorage(field: LinkFieldDto, table: string, foreignTable: string): boolean {
    const { fkHostTableName, selfKeyName, foreignKeyName } = field.options;
    if (!fkHostTableName || !selfKeyName || !foreignKeyName) {
      throw new Error('Incomplete imported relationship metadata');
    }
    const isJunction = selfKeyName !== '__id' && foreignKeyName !== '__id';
    const invalidHost = isJunction
      ? fkHostTableName === table || fkHostTableName === foreignTable
      : fkHostTableName !== (selfKeyName === '__id' ? table : foreignTable);
    if (invalidHost) throw new Error('Invalid imported relationship storage');
    return isJunction;
  }

  private async importJunctionChunk(path: string, baseId: string, links: IImportedLink[]) {
    const fallback = { skippedCells: 0, junctions: new Set<string>() };
    const byArchiveName = new Map<string, IImportedLink>();
    const junctions = new Map<string, IImportedLink>();
    for (const link of links) {
      if (!link.isJunction) continue;
      byArchiveName.set(link.sourceOptions.fkHostTableName, link);
      // Read one orientation per physical junction, not both symmetric caches.
      if (!junctions.has(link.field.options.fkHostTableName)) {
        junctions.set(link.field.options.fkHostTableName, link);
      }
    }
    if (!junctions.size) return fallback;
    const restored = new Set<string>();
    const knex = await this.dataDbClientManager.dataKnexForBase(baseId);
    const prisma = await this.dataDbClientManager.dataPrismaForBase(baseId);
    await this.readArchive(path, (entry) => {
      if (!entry.path.startsWith('tables/') || !entry.path.endsWith('.csv')) return;
      const archiveName = entry.path.slice('tables/'.length, -'.csv'.length);
      const link = byArchiveName.get(archiveName);
      if (!link) {
        if (archiveName.includes('junction_')) {
          throw new Error('Unknown imported junction metadata');
        }
        return;
      }
      const target = link.field.options;
      if (restored.has(target.fkHostTableName)) return;
      restored.add(target.fkHostTableName);
      // Restart a failed attempt without duplicating already-committed batches.
      const prepare = () =>
        prisma.$executeRawUnsafe(knex(target.fkHostTableName).delete().toQuery());
      const source = link.sourceOptions;
      const headerMap: Record<string, string> = {
        [source.selfKeyName]: target.selfKeyName,
        [source.foreignKeyName]: target.foreignKeyName,
        [`${source.selfKeyName}_order`]: `${target.selfKeyName}_order`,
        [`${source.foreignKeyName}_order`]: `${target.foreignKeyName}_order`,
      };
      return {
        prepare,
        mapHeader: (header: string) => headerMap[header] ?? header,
        handle: (chunk: Record<string, unknown>[]) =>
          this.handleJunctionChunk(baseId, chunk, target.fkHostTableName),
      };
    });

    const missing = [...junctions.values()].filter(
      (link) => !restored.has(link.field.options.fkHostTableName)
    );
    if (!missing.length) return fallback;
    // V2 exports legitimately have only table CSVs. Link caches are not guaranteed
    // to survive the V1 table importer, so stream those columns from the archive.
    for (const link of missing) {
      fallback.junctions.add(link.field.options.fkHostTableName);
      await prisma.$executeRawUnsafe(knex(link.field.options.fkHostTableName).delete().toQuery());
    }
    const byTable = new Map<string, IImportedLink[]>();
    // Count actual archive cells from both orientations, including tables that
    // are not needed to reconstruct the representative junction orientation.
    for (const link of links) {
      if (!link.isJunction || !fallback.junctions.has(link.field.options.fkHostTableName)) {
        continue;
      }
      const tableLinks = byTable.get(link.sourceTableId) ?? [];
      tableLinks.push(link);
      byTable.set(link.sourceTableId, tableLinks);
    }
    const countedRecords = new Map<string, Set<string>>();
    const restoredTables = new Set<string>();
    await this.readArchive(path, (entry) => {
      if (!entry.path.startsWith('tables/') || !entry.path.endsWith('.csv')) return;
      const tableId = entry.path.slice('tables/'.length, -'.csv'.length);
      const tableLinks = byTable.get(tableId);
      if (!tableLinks || restoredTables.has(tableId)) return;
      restoredTables.add(tableId);
      const insertionLinks = tableLinks.filter(
        (link) => junctions.get(link.field.options.fkHostTableName) === link
      );
      return {
        handle: async (chunk: Record<string, unknown>[]) => {
          fallback.skippedCells += await this.countTableLinkCells(
            baseId,
            tableLinks,
            chunk,
            countedRecords
          );
          await this.restoreTableLinkChunk(baseId, insertionLinks, chunk);
        },
      };
    });
    if (restoredTables.size !== byTable.size) {
      throw new Error('Missing imported relationship table CSV');
    }
    return fallback;
  }

  private async readArchive(
    path: string,
    select: (entry: unzipper.Entry) =>
      | {
          prepare?: () => Promise<unknown>;
          mapHeader?: (header: string) => string;
          handle: (chunk: Record<string, unknown>[]) => Promise<void>;
        }
      | undefined
  ): Promise<void> {
    const stream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const parser = unzipper.Parse();
    const entries = new Set<unzipper.Entry>();
    const imports: Promise<unknown>[] = [];
    const chunks = new Set<Promise<void>>();
    let firstError: Error | undefined;
    const stop = (error: Error) => {
      if (firstError) return;
      firstError = error;
      stream.destroy(error);
      parser.destroy(error);
      for (const entry of entries) entry.destroy(error);
    };
    // finished(cleanup: true) releases its observers at logical finish, but
    // pending SQL can still destroy unzipper's not-yet-destroyed parser later.
    // Keep these stream-lifetime observers; firstError is still thrown below.
    stream.on('error', stop);
    parser.on('error', stop);
    // Different junctions can still lock the same referenced tables during FK
    // DDL. Serialize SQL for this archive/job, not across independent imports.
    let sqlChain = Promise.resolve();
    const serialize = (operation: () => Promise<unknown>): Promise<void> => {
      const pending = sqlChain.then(async () => {
        if (firstError) throw firstError;
        await operation();
      });
      sqlChain = pending;
      void pending.catch(stop);
      return pending;
    };
    parser.on('entry', (entry: unzipper.Entry) => {
      entries.add(entry);
      entry.on('error', stop);
      try {
        const selected = !firstError && entry.type !== 'Directory' ? select(entry) : undefined;
        if (!selected) {
          // Mark the entry for synchronous autodrain before unzipper decides to
          // inflate it, but observe the entry itself so destroy/errors settle it.
          entry.autodrain();
          const drain = finished(entry, { cleanup: true }).then(() => {
            entries.delete(entry);
          });
          imports.push(drain);
          void drain.catch(stop);
          return;
        }
        const prepare = selected.prepare ? serialize(selected.prepare) : Promise.resolve();
        imports.push(prepare);
        void prepare.catch(stop);
        const batch = new BatchProcessor<Record<string, unknown>>(async (rows) => {
          const chunk = serialize(async () => {
            await prepare;
            await selected.handle(rows);
          });
          chunks.add(chunk);
          try {
            await chunk;
          } finally {
            chunks.delete(chunk);
          }
        });
        const imported = pipeline(
          entry,
          csvParser.default({
            mapHeaders: ({ header }) => {
              const name = header.replace(/^\uFEFF/, '');
              return selected.mapHeader?.(name) ?? name;
            },
            mapValues: ({ value }) => (value === '' ? null : value),
          }),
          batch
        ).then(async () => {
          await prepare;
          entries.delete(entry);
        });
        imports.push(imported);
        void imported.catch(stop);
      } catch (error) {
        entry.destroy(error as Error);
        stop(error as Error);
      }
    });
    // unzipper 0.12.3 is a Duplex that manually emits end/close from its writable
    // finish without completing Node's readable state. A Duplex pipeline therefore
    // rejects valid ZIPs with Premature close. Observe only the parser's writable
    // side, and separately await the real source and every entry/SQL batch.
    const sourceFinished = finished(stream, { cleanup: true });
    const parserFinished = finished(parser, { readable: false, cleanup: true }).then(() => {
      // The parser ends itself at the ZIP directory and unpipes/pauses its
      // upstream. Drain the source to its real end instead of leaving it paused.
      stream.unpipe(parser);
      stream.resume();
    });
    void sourceFinished.catch(stop);
    void parserFinished.catch(stop);
    stream.pipe(parser);
    await Promise.allSettled([sourceFinished, parserFinished]);
    const results = await Promise.allSettled(imports);
    await Promise.allSettled([sqlChain, ...chunks]);
    if (firstError) throw firstError;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  private async countTableLinkCells(
    baseId: string,
    links: IImportedLink[],
    rows: Record<string, unknown>[],
    countedRecords: Map<string, Set<string>>
  ): Promise<number> {
    const knex = await this.dataDbClientManager.dataKnexForBase(baseId);
    const prisma = await this.dataDbClientManager.dataPrismaForBase(baseId);
    const sourceIds = rows.map((row) => {
      if (typeof row.__id !== 'string' || !row.__id) {
        throw new Error('Invalid imported relationship source record');
      }
      return row.__id;
    });
    const survivingSources = new Set<string>();
    for (let offset = 0; offset < sourceIds.length; offset += 500) {
      const existing = await prisma.$queryRawUnsafe<{ __id: string }[]>(
        knex(links[0].dbTableName)
          .select('__id')
          .whereIn('__id', sourceIds.slice(offset, offset + 500))
          .toQuery()
      );
      for (const { __id } of existing) survivingSources.add(__id);
    }
    let skippedCells = 0;
    for (const link of links) {
      const skippedRecords = countedRecords.get(link.field.id) ?? new Set<string>();
      countedRecords.set(link.field.id, skippedRecords);
      const previouslySkipped = skippedRecords.size;
      const pending = new Map<string, Set<string>>();
      const checkTargets = async () => {
        const existing = await prisma.$queryRawUnsafe<{ __id: string }[]>(
          knex(link.foreignDbTableName)
            .select('__id')
            .whereIn('__id', [...pending.keys()])
            .toQuery()
        );
        const existingIds = new Set(existing.map(({ __id }) => __id));
        for (const [targetId, sourceIds] of pending) {
          if (existingIds.has(targetId)) continue;
          for (const sourceId of sourceIds) skippedRecords.add(sourceId);
        }
        pending.clear();
      };
      for (const row of rows) {
        if (!survivingSources.has(row.__id as string)) continue;
        for (const cell of this.importedLinkCells(link, row)) {
          const id = this.importedLinkId(cell);
          const sourceId = row.__id as string;
          if (skippedRecords.has(sourceId)) continue;
          const sources = pending.get(id) ?? new Set<string>();
          sources.add(sourceId);
          pending.set(id, sources);
          // Bound target queries independently of the number of IDs in one cell.
          if (pending.size === 500) await checkTargets();
        }
      }
      if (pending.size) await checkTargets();
      skippedCells += skippedRecords.size - previouslySkipped;
    }
    return skippedCells;
  }

  private async restoreTableLinkChunk(
    baseId: string,
    links: IImportedLink[],
    rows: Record<string, unknown>[]
  ) {
    for (const link of links) {
      await this.restoreDisplayedLink(baseId, link, rows);
    }
  }

  private async restoreDisplayedLink(
    baseId: string,
    link: IImportedLink,
    rows: Record<string, unknown>[]
  ) {
    const { fkHostTableName } = link.field.options;
    let edges: Record<string, unknown>[] = [];
    for (const edge of this.tableLinkEdges(link, rows)) {
      edges.push(edge);
      if (edges.length === BatchProcessor.BATCH_SIZE) {
        await this.handleJunctionChunk(baseId, edges, fkHostTableName);
        edges = [];
      }
    }
    if (edges.length) await this.handleJunctionChunk(baseId, edges, fkHostTableName);
  }

  private *tableLinkEdges(link: IImportedLink, rows: Record<string, unknown>[]) {
    const { selfKeyName, foreignKeyName } = link.field.options;
    for (const row of rows) {
      const cells = this.importedLinkCells(link, row);
      const ids = new Set<string>();
      for (const [order, cell] of cells.entries()) {
        const id = this.importedLinkId(cell);
        if (ids.has(id)) continue;
        ids.add(id);
        const edge: Record<string, unknown> = {
          [selfKeyName]: row.__id,
          [foreignKeyName]: id,
        };
        if (link.field.getHasOrderColumn()) {
          edge[link.field.getOrderColumnName()] = order;
        }
        yield edge;
      }
    }
  }

  private importedLinkCells(link: IImportedLink, row: Record<string, unknown>): unknown[] {
    if (typeof row.__id !== 'string' || !row.__id) {
      throw new Error('Invalid imported relationship source record');
    }
    if (!(link.sourceDbFieldName in row)) {
      throw new Error('Missing imported relationship column');
    }
    const value = row[link.sourceDbFieldName];
    if (value == null || value === '') return [];
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  private importedLinkId(cell: unknown): string {
    if (
      !cell ||
      typeof cell !== 'object' ||
      !('id' in cell) ||
      typeof cell.id !== 'string' ||
      !cell.id
    ) {
      throw new Error('Invalid imported relationship cell');
    }
    return cell.id;
  }

  private recordForLinkKey(knex: Knex, table: string, alias: string, key: string) {
    return knex({ [alias]: table })
      .select(knex.raw('1'))
      .whereRaw('?? = ??', [`${alias}.__id`, `edge.${key}`]);
  }

  private danglingCells(knex: Knex, link: IImportedLink) {
    const { fkHostTableName, selfKeyName, foreignKeyName } = link.field.options;
    return knex({ edge: fkHostTableName })
      .whereNotNull(`edge.${foreignKeyName}`)
      .whereExists(this.recordForLinkKey(knex, link.dbTableName, 'source', selfKeyName))
      .whereNotExists(
        this.recordForLinkKey(knex, link.foreignDbTableName, 'target', foreignKeyName)
      );
  }

  private async clearDanglingLinks(
    baseId: string,
    links: IImportedLink[],
    archiveCountedJunctions: Set<string>
  ): Promise<number> {
    const knex = await this.dataDbClientManager.dataKnexForBase(baseId);
    const dataPrisma = (await this.dataDbClientManager.dataPrismaForBase(
      baseId
    )) as IDataPrismaScopedClient;
    return this.dataTransaction(dataPrisma, async (prisma) => {
      let skippedCells = 0;
      // Count all field orientations before deleting anything. Missing source rows
      // do not represent living cells; multiple invalid edges count only once.
      for (const link of links) {
        if (link.isJunction && archiveCountedJunctions.has(link.field.options.fkHostTableName)) {
          continue;
        }
        const result = await prisma.$queryRawUnsafe<{ count: string | number }[]>(
          this.danglingCells(knex, link)
            .countDistinct({ count: `edge.${link.field.options.selfKeyName}` })
            .toQuery()
        );
        skippedCells += Number(result[0].count);
      }
      const cleaned = new Set<string>();
      for (const link of links) {
        await this.clearDanglingLink(prisma, knex, link, cleaned);
      }
      return skippedCells;
    });
  }

  private async clearDanglingLink(
    prisma: IDataPrismaExecutor,
    knex: Knex,
    link: IImportedLink,
    cleaned: Set<string>
  ) {
    const { fkHostTableName, selfKeyName, foreignKeyName } = link.field.options;
    if (link.isJunction) {
      if (cleaned.has(fkHostTableName)) return;
      cleaned.add(fkHostTableName);
      const sql = knex({ edge: fkHostTableName })
        .whereNotExists(this.recordForLinkKey(knex, link.dbTableName, 'source', selfKeyName))
        .orWhereNotExists(
          this.recordForLinkKey(knex, link.foreignDbTableName, 'target', foreignKeyName)
        )
        .delete()
        .toQuery();
      await prisma.$executeRawUnsafe(sql);
      return;
    }
    const key = selfKeyName === '__id' ? foreignKeyName : selfKeyName;
    const target = selfKeyName === '__id' ? link.foreignDbTableName : link.dbTableName;
    const storageKey = `${fkHostTableName}:${key}`;
    if (cleaned.has(storageKey)) return;
    cleaned.add(storageKey);
    const sql = knex({ edge: fkHostTableName })
      .whereNotNull(`edge.${key}`)
      .whereNotExists(this.recordForLinkKey(knex, target, 'target', key))
      .update({ [key]: null })
      .toQuery();
    await prisma.$executeRawUnsafe(sql);
  }

  private async dataTransaction<T>(
    dataPrisma: IDataPrismaScopedClient,
    fn: (prisma: IDataPrismaExecutor) => Promise<T>
  ) {
    // ZIP entries may flush concurrently. Each batch must own its transaction
    // slots rather than reuse another entry's dataTx.client through CLS.
    return this.cls.runWith({ ...this.cls.get(), tx: {}, dataTx: {} }, async () => {
      if (dataPrisma.$tx) {
        return await dataPrisma.$tx(fn);
      }

      if (dataPrisma.$transaction) {
        return await dataPrisma.$transaction(fn);
      }

      return await fn(dataPrisma);
    });
  }

  private async handleJunctionChunk(
    baseId: string,
    results: Record<string, unknown>[],
    targetFkHostTableName: string
  ) {
    const allForeignKeyInfos = [] as {
      constraint_name: string;
      column_name: string;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      delete_rule: string;
      dbTableName: string;
    }[];

    const dataPrisma = (await this.dataDbClientManager.dataPrismaForBase(
      baseId
    )) as IDataPrismaScopedClient;
    const dataKnex = await this.dataDbClientManager.dataKnexForBase(baseId);

    await this.dataTransaction(dataPrisma, async (prisma) => {
      // delete foreign keys if(exist) then duplicate table data
      const foreignKeysInfoSql = this.dbProvider.getForeignKeysInfo(targetFkHostTableName);
      const foreignKeysInfo = await prisma.$queryRawUnsafe<
        {
          constraint_name: string;
          column_name: string;
          referenced_table_schema: string;
          referenced_table_name: string;
          referenced_column_name: string;
          delete_rule: string;
        }[]
      >(foreignKeysInfoSql);
      const newForeignKeyInfos = foreignKeysInfo.map((info) => ({
        ...info,
        dbTableName: targetFkHostTableName,
      }));
      allForeignKeyInfos.push(...newForeignKeyInfos);

      for (const { constraint_name, column_name, dbTableName } of allForeignKeyInfos) {
        const dropForeignKeyQuery = dataKnex.schema
          .alterTable(dbTableName, (table) => {
            table.dropForeign(column_name, constraint_name);
          })
          .toQuery();

        await prisma.$executeRawUnsafe(dropForeignKeyQuery);
      }

      const sql = dataKnex.table(targetFkHostTableName).insert(results).toQuery();
      await prisma.$executeRawUnsafe(sql);

      // add foreign keys with NOT VALID to skip existing data validation
      for (const {
        constraint_name,
        column_name,
        dbTableName,
        referenced_table_schema: referencedTableSchema,
        referenced_table_name: referencedTableName,
        referenced_column_name: referencedColumnName,
        delete_rule: deleteRule,
      } of allForeignKeyInfos) {
        const [schema, tableName] = dbTableName.split('.');
        const addForeignKeyQuery = postgresAddForeignKeyNotValidSql(dataKnex, {
          schema,
          tableName,
          constraintName: constraint_name,
          columnName: column_name,
          referencedTableSchema,
          referencedTableName,
          referencedColumnName,
          deleteRule,
        });
        await prisma.$executeRawUnsafe(addForeignKeyQuery);
      }
    });
  }
}
