import { Injectable } from '@nestjs/common';
import { FieldType, PRIMARY_SUPPORTED_TYPES, generateFieldId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IntegrityIssueType, type IIntegrityIssue } from '@teable/openapi';
import {
  resolvePostgresDbOrTx,
  v2DataDbTokens,
  v2MetaDbTokens,
} from '@teable/v2-adapter-db-postgres-shared';
import type { V1TeableDatabase } from '@teable/v2-adapter-repository-postgres';
import {
  BaseId,
  CreateFieldCommand,
  DbTableName,
  FieldCreated,
  FieldId,
  FieldUpdated,
  Table,
  TableAddFieldSpec,
  TableId,
  UpdateFieldCommand,
  registerAfterCommit,
  registerAfterRollback,
  v2CoreTokens,
  withoutTransaction,
  domainError,
  type CreateFieldResult,
  type IDomainEvent,
  type IEventBus,
  type ICommandBus,
  type IExecutionContext,
  type ITableRepository,
  type ITableSchemaRepository,
  type IUnitOfWork,
  type DomainError,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { sql, type Kysely, type Selectable } from 'kysely';
import { err, ok, type Result } from 'neverthrow';
import { throwV2QueryDomainError } from '../aggregation/open-api/aggregation-v2-result.mapper';
import { FieldCacheService } from '../field-cache/field-cache.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';

type FieldRow = Selectable<V1TeableDatabase['field']>;

/** Corruption repair only. Normal field commands keep the aggregate's primary-field invariants. */
@Injectable()
export class IntegrityPrimaryRepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly fieldCache: FieldCacheService
  ) {}

  private eligible(field: FieldRow): boolean {
    return (
      field.is_lookup === null &&
      field.is_conditional_lookup === null &&
      field.lookup_options === null &&
      PRIMARY_SUPPORTED_TYPES.has(field.type as FieldType)
    );
  }

  async fixInvalidPrimary(
    fieldId: string,
    issueType: IntegrityIssueType
  ): Promise<IIntegrityIssue | undefined> {
    const field = await this.prisma.field.findFirst({
      where: { id: fieldId, deletedTime: null, isPrimary: true },
      select: { tableId: true },
    });
    if (!field) return;
    return this.repair(field.tableId, fieldId, issueType);
  }

  async fixMissingPrimary(tableId: string): Promise<IIntegrityIssue | undefined> {
    return this.repair(tableId, undefined, IntegrityIssueType.MissingPrimary);
  }

  private async repair(
    tableId: string,
    invalidFieldId: string | undefined,
    issueType: IntegrityIssueType
  ): Promise<IIntegrityIssue | undefined> {
    const identity = await this.prisma.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: { baseId: true },
    });
    if (!identity) return;
    const domainTableId = TableId.create(tableId);
    if (domainTableId.isErr()) throwV2QueryDomainError(domainTableId.error);
    const domainBaseId = BaseId.create(identity.baseId);
    if (domainBaseId.isErr()) throwV2QueryDomainError(domainBaseId.error);
    const container = await this.containers.getContainerForBase(identity.baseId);
    const context = await this.contexts.createContext(container);
    const metaDb = container.resolve<Kysely<V1TeableDatabase>>(v2MetaDbTokens.db);
    const unitOfWork = container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
    const result = await unitOfWork.withTransaction<IIntegrityIssue | undefined>(
      context,
      async (txContext) => {
        const db = resolvePostgresDbOrTx(metaDb, txContext, 'meta');
        const table = await db
          .selectFrom('table_meta')
          .selectAll()
          .where('id', '=', tableId)
          .where('deleted_time', 'is', null)
          .forUpdate()
          .executeTakeFirst();
        if (!table) return ok(undefined);
        const fields = await db
          .selectFrom('field')
          .selectAll()
          .where('table_id', '=', tableId)
          .where('deleted_time', 'is', null)
          .orderBy('order', 'asc')
          .execute();
        const old = invalidFieldId
          ? fields.find((field) => field.id === invalidFieldId && field.is_primary)
          : undefined;
        if (invalidFieldId && !old) return ok(undefined);
        if (!invalidFieldId && fields.some((field) => field.is_primary)) return ok(undefined);

        const publishAfterCommit = (event: IDomainEvent) => {
          const registered = registerAfterCommit(txContext, async () => {
            this.fieldCache.invalidateTables(tableId);
            const published = await container
              .resolve<IEventBus>(v2CoreTokens.eventBus)
              .publishMany(withoutTransaction(context), [event]);
            if (published.isErr()) throwV2QueryDomainError(published.error);
          });
          if (!registered) throw new Error('Integrity repair requires native after-commit hooks');
        };
        const setPrimary = async (field: FieldRow, primary: boolean) => {
          const domainFieldId = FieldId.create(field.id);
          if (domainFieldId.isErr()) throwV2QueryDomainError(domainFieldId.error);
          const now = new Date();
          await db
            .updateTable('field')
            .set({
              is_primary: primary ? true : null,
              version: field.version + 1,
              last_modified_time: now,
              last_modified_by: context.actorId.toString(),
            })
            .where('id', '=', field.id)
            .execute();
          publishAfterCommit(
            FieldUpdated.create({
              tableId: domainTableId.value,
              baseId: domainBaseId.value,
              fieldId: domainFieldId.value,
              updatedProperties: ['isPrimary'],
              changes: {
                isPrimary: { oldValue: field.is_primary, newValue: primary ? true : null },
              },
              oldVersion: field.version,
              newVersion: field.version + 1,
            })
          );
        };
        if (old) await setPrimary(old, false);
        const validPrimary = fields.find(
          (field) => field.id !== old?.id && field.is_primary && this.eligible(field)
        );
        const candidate =
          validPrimary ?? fields.find((field) => field.id !== old?.id && this.eligible(field));
        let issue: IIntegrityIssue;
        if (candidate) {
          if (!validPrimary) await setPrimary(candidate, true);
          issue = old
            ? {
                type: issueType,
                fieldId: old.id,
                message: validPrimary
                  ? `Demoted invalid primary "${old.name}" (id ${old.id}). Existing valid primary "${candidate.name}" (${candidate.id}) preserved.`
                  : `Demoted invalid primary "${old.name}" (id ${old.id}). Promoted existing field "${candidate.name}" (${candidate.id}) to primary.`,
              }
            : {
                type: issueType,
                fieldId: candidate.id,
                tableId,
                message: `Promoted existing field "${candidate.name}" (${candidate.id}) to primary in table "${table.name}".`,
              };
        } else {
          const createdId = generateFieldId();
          if (fields.length === 0) {
            const bootstrapped = await this.bootstrapEmptyTable(
              container,
              txContext,
              table,
              createdId
            );
            if (bootstrapped.isErr()) return err(bootstrapped.error);
            publishAfterCommit(bootstrapped.value);
          } else {
            const bus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
            if (old) {
              const rename = UpdateFieldCommand.create({
                tableId,
                fieldId: old.id,
                field: { name: `${old.name} (before-fix)` },
              });
              if (rename.isErr()) return err(rename.error);
              const renamed = await bus.execute(txContext, rename.value);
              if (renamed.isErr()) return err(renamed.error);
            }
            const create = CreateFieldCommand.create({
              baseId: identity.baseId,
              tableId,
              field: old
                ? {
                    id: createdId,
                    type: 'formula',
                    name: old.name,
                    options: { expression: `{${old.id}}` },
                  }
                : { id: createdId, type: 'singleLineText', name: 'Name' },
            });
            if (create.isErr()) return err(create.error);
            const created = await bus.execute<CreateFieldCommand, CreateFieldResult>(
              txContext,
              create.value
            );
            if (created.isErr()) return err(created.error);
            const persisted = await db
              .selectFrom('field')
              .selectAll()
              .where('id', '=', createdId)
              .executeTakeFirstOrThrow();
            await setPrimary(persisted, true);
          }
          issue = old
            ? {
                type: issueType,
                fieldId: old.id,
                message: `Demoted invalid primary "${old.name}" (renamed to "${old.name} (before-fix)", id ${old.id}). Added new formula field "${old.name}" (${createdId}) as primary, mirroring the original value.`,
              }
            : {
                type: issueType,
                fieldId: createdId,
                tableId,
                message: `Added "Name" text field (${createdId}) as primary in table "${table.name}".`,
              };
        }
        await db
          .updateTable('table_meta')
          .set({
            version: sql<number>`version + 1`,
            last_modified_time: new Date(),
            last_modified_by: context.actorId.toString(),
          })
          .where('id', '=', tableId)
          .execute();
        return ok(issue);
      },
      { scope: 'meta', retry: false }
    );
    if (result.isErr()) throwV2QueryDomainError(result.error);
    return result.value;
  }

  /** Establish a real initial field before loading an otherwise invalid empty aggregate. */
  private async bootstrapEmptyTable(
    container: DependencyContainer,
    context: IExecutionContext,
    table: Selectable<V1TeableDatabase['table_meta']>,
    fieldId: string
  ): Promise<Result<FieldCreated, DomainError>> {
    const metaDb = container.resolve<Kysely<V1TeableDatabase>>(v2MetaDbTokens.db);
    const db = resolvePostgresDbOrTx(metaDb, context, 'meta');
    const dataDb = container.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
    const tableName = DbTableName.rehydrate(table.db_table_name);
    if (tableName.isErr()) return err(tableName.error);
    const location = tableName.value.split({ defaultSchema: 'public' });
    if (location.isErr()) return err(location.error);
    const { schema, tableName: physicalName } = location.value;
    const reserved = await sql<{
      column_name: string;
    }>`select column_name from information_schema.columns
      where table_schema = ${schema ?? 'public'} and table_name = ${physicalName}`.execute(dataDb);
    const names = new Set(reserved.rows.map((row) => row.column_name));
    let dbFieldName = 'Name';
    for (let suffix = 2; names.has(dbFieldName); suffix++) dbFieldName = `Name_${suffix}`;
    const now = new Date();
    await db
      .insertInto('field')
      .values({
        id: fieldId,
        table_id: table.id,
        name: 'Name',
        type: 'singleLineText',
        db_field_name: dbFieldName,
        db_field_type: 'TEXT',
        cell_value_type: 'string',
        is_multiple_cell_value: false,
        is_primary: true,
        is_computed: null,
        is_lookup: null,
        is_conditional_lookup: null,
        is_pending: null,
        has_error: null,
        not_null: null,
        unique: null,
        description: null,
        options: '{}',
        meta: null,
        ai_config: null,
        lookup_linked_field_id: null,
        lookup_options: null,
        order: 1,
        version: 1,
        created_time: now,
        last_modified_time: now,
        deleted_time: null,
        created_by: context.actorId.toString(),
        last_modified_by: context.actorId.toString(),
      })
      .execute();
    const baseId = BaseId.create(table.base_id);
    if (baseId.isErr()) return err(baseId.error);
    const id = TableId.create(table.id);
    if (id.isErr()) return err(id.error);
    const spec = Table.specs(baseId.value).byId(id.value).build();
    if (spec.isErr()) return err(spec.error);
    const loaded = await container
      .resolve<ITableRepository>(v2CoreTokens.tableRepository)
      .findOne(context, spec.value);
    if (loaded.isErr()) return err(loaded.error);
    const field = loaded.value.getFields().find((value) => value.id().toString() === fieldId);
    if (!field) return err(domainError.notFound({ message: 'Bootstrap field not found' }));
    // Separate BYODB data handles cannot share a metadata SQL transaction. Only this newly
    // allocated column belongs to the bootstrap, so remove it if the metadata owner rolls back.
    let columnCreated = false;
    let metadataCommitted = false;
    registerAfterCommit(context, () => {
      metadataCommitted = true;
    });
    registerAfterRollback(context, async () => {
      if (!columnCreated || metadataCommitted) return;
      const target = schema ? `${schema}.${physicalName}` : physicalName;
      await sql`alter table ${sql.table(target)} drop column if exists ${sql.ref(dbFieldName)}`.execute(
        dataDb
      );
    });
    const schemaResult = await container
      .resolve<IUnitOfWork>(v2CoreTokens.unitOfWork)
      .withTransaction(
        context,
        (dataContext) =>
          container
            .resolve<ITableSchemaRepository>(v2CoreTokens.tableSchemaRepository)
            .update(dataContext, loaded.value, TableAddFieldSpec.create(field)),
        { scope: 'data', retry: false }
      );
    if (schemaResult.isErr()) return err(schemaResult.error);
    columnCreated = true;
    const views = await db
      .selectFrom('view')
      .select(['id', 'column_meta'])
      .where('table_id', '=', table.id)
      .where('deleted_time', 'is', null)
      .execute();
    const viewOrders: Record<string, number> = {};
    for (const view of views) {
      const columnMeta = JSON.parse(view.column_meta) as Record<string, { order: number }>;
      const order = Math.max(-1, ...Object.values(columnMeta).map((entry) => entry.order)) + 1;
      columnMeta[fieldId] = { order };
      viewOrders[view.id] = order;
      await db
        .updateTable('view')
        .set({
          column_meta: JSON.stringify(columnMeta),
          version: sql<number>`version + 1`,
          last_modified_time: now,
          last_modified_by: context.actorId.toString(),
        })
        .where('id', '=', view.id)
        .execute();
    }
    return ok(
      FieldCreated.create({
        tableId: id.value,
        baseId: baseId.value,
        fieldId: field.id(),
        viewOrders,
      })
    );
  }
}
