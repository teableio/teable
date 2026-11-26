import { Injectable } from '@nestjs/common';
import { DbFieldType } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { PostgresTableRepository } from '@teable/v2-adapter-repository-postgres';
import { mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import {
  DefaultTableMapper,
  domainError,
  err,
  ok,
  type DomainError,
  type Result,
  FieldClipboardValueVisitor,
  ListTableRecordsQuery,
  MAX_RECORDS_LIMIT,
  RecordId,
  tableProvisionPendingError,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type IQueryBus,
  type ITableRepository,
  type ListTableRecordsResult,
} from '@teable/v2-core';
import { DatabaseRouter } from '../../global/database-router.service';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { throwV2Error } from './v2-http-error';

type RecordTitle = { id: string; title: string };

@Injectable()
export class RecordTitleReader {
  constructor(
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly prisma: PrismaService,
    private readonly databaseRouter: DatabaseRouter
  ) {}

  async byIds(tableId: string, ids: readonly string[]): Promise<RecordTitle[]> {
    if (!ids.length) return [];
    const prisma = this.prisma.txClient();
    // The v2 repository would check out a second pool connection during a v1 write.
    const result = await (prisma === this.prisma
      ? this.tryByIds(tableId, ids)
      : this.byIdsInPrismaTransaction(prisma, tableId, ids));
    if (result.isErr()) throwV2Error(result.error, mapDomainErrorToHttpStatus(result.error));
    return result.value;
  }

  private async byIdsInPrismaTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    ids: readonly string[]
  ): Promise<Result<RecordTitle[], DomainError>> {
    const id = TableId.create(tableId);
    if (id.isErr()) return err(id.error);
    this.contexts.requireActorId();
    const table = await prisma.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: {
        dbTableName: true,
        provisionState: true,
        base: { select: { spaceId: true } },
        fields: { where: { isPrimary: true, deletedTime: null }, take: 1 },
      },
    });
    if (!table) return err(domainError.notFound({ message: `Table ${tableId} not found` }));
    if (table.provisionState === 'pending') return err(tableProvisionPendingError());
    const [primaryField] = table.fields;
    if (!primaryField) {
      return err(domainError.notFound({ message: `No primary field found in table ${tableId}` }));
    }

    const primary = new DefaultTableMapper().fieldFromDTO(PostgresTableRepository.deserializeFieldDto({
      ...primaryField,
      ai_config: primaryField.aiConfig,
      cell_value_type: primaryField.cellValueType,
      is_multiple_cell_value: primaryField.isMultipleCellValue,
      not_null: primaryField.notNull,
      is_computed: primaryField.isComputed,
      is_lookup: primaryField.isLookup,
      is_conditional_lookup: primaryField.isConditionalLookup,
      has_error: primaryField.hasError,
      lookup_linked_field_id: primaryField.lookupLinkedFieldId,
      lookup_options: primaryField.lookupOptions,
      db_field_name: primaryField.dbFieldName,
      db_field_type: primaryField.dbFieldType,
      is_pending: primaryField.isPending,
    }));
    if (primary.isErr()) return err(primary.error);
    const executor = await this.databaseRouter.dataPrismaExecutorForSpaceTransactionRead(
      table.base.spaceId
    );
    const knex = this.databaseRouter.dataKnex();
    // Text preserves the database timestamp offset through Prisma's raw result decoder.
    const column = primaryField.dbFieldName;
    const projection = primary.value.computed().toBoolean() && primary.value.hasError().isError()
      ? knex.raw('NULL')
      : primaryField.dbFieldType === DbFieldType.DateTime
        ? knex.raw('??::text', [column])
        : knex.ref(column);
    const titles: RecordTitle[] = [];
    for (let offset = 0; offset < ids.length; offset += MAX_RECORDS_LIMIT) {
      const batch = ids.slice(offset, offset + MAX_RECORDS_LIMIT);
      for (const recordId of batch) {
        const record = RecordId.forLookup(recordId);
        if (record.isErr()) return err(record.error);
      }
      const query = knex(table.dbTableName)
        .select({ id: '__id', title: projection })
        .whereIn('__id', batch)
        .toSQL()
        .toNative();
      const records = await executor.$queryRawUnsafe<{ id: string; title: unknown }[]>(
        query.sql,
        ...query.bindings
      );
      for (const record of records) {
        const title = primary.value.accept(new FieldClipboardValueVisitor(record.title));
        if (title.isErr()) return err(title.error);
        titles.push({ id: record.id, title: title.value });
      }
    }
    return ok(titles);
  }

  async tryByIds(
    tableId: string,
    ids: readonly string[],
    mode: 'strict' | 'best-effort' = 'strict'
  ): Promise<Result<RecordTitle[], DomainError>> {
    if (!ids.length) return ok([]);
    const id = TableId.create(tableId);
    if (id.isErr()) return err(id.error);
    const container = await this.containers.getContainerForTable(tableId);
    const context = await this.contexts.createContext(container);
    const repository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const table = await repository.findOne(context, TableByIdSpec.create(id.value));
    if (table.isErr()) return err(table.error);
    const primary = table.value.primaryField();
    if (primary.isErr()) return err(primary.error);
    const primaryId = primary.value.id().toString();
    const bus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const titles: RecordTitle[] = [];
    for (let offset = 0; offset < ids.length; offset += MAX_RECORDS_LIMIT) {
      const batch = ids.slice(offset, offset + MAX_RECORDS_LIMIT);
      const query = ListTableRecordsQuery.create({
        tableId,
        selectedRecordIds: batch,
        projection: [primaryId],
        limit: batch.length,
        fieldKeyType: 'id',
        ignoreViewQuery: true,
        includeTotal: false,
      }, { table: table.value });
      if (query.isErr()) return err(query.error);
      const page = await bus.execute<ListTableRecordsQuery, ListTableRecordsResult>(context, query.value);
      if (page.isErr()) {
        if (mode === 'best-effort') continue;
        return err(page.error);
      }
      for (const record of page.value.records) {
        const raw = record.fields[primaryId];
        const title = primary.value.accept(new FieldClipboardValueVisitor(raw));
        titles.push({ id: record.id, title: title.isOk() ? title.value : String(raw ?? '') });
      }
    }
    return ok(titles);
  }
}
