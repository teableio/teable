import { Injectable, Logger } from '@nestjs/common';
import {
  extractFieldIdsFromFilter,
  FieldType,
  filterSchema,
  groupSchema,
  sortSchema,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IFieldDeleteReferencesVo,
  IFieldDeleteRefDependentField,
  IFieldDeleteRefTableSource,
  IPlanFieldVo,
  ITableDeleteReferencesVo,
} from '@teable/openapi';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import {
  FieldDependencyGraph,
  v2RecordRepositoryPostgresTokens,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  DeleteTableCommand,
  FieldId,
  NoopFieldVisitor,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type DomainError,
  type Field,
  type LinkField,
  type ITableRepository,
  type TableDeletionPreparationService,
} from '@teable/v2-core';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { ThresholdConfig, type IThresholdConfig } from '../../../configs/threshold.config';
import { baseDisplayName } from '../../../utils/base-name';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';

const unwrap = <T>(result: Result<T, DomainError>): T => {
  if (result.isErr())
    throwV2Error(mapDomainErrorToHttpError(result.error), mapDomainErrorToHttpStatus(result.error));
  return result.value;
};
const parse = <T>(
  raw: string | null,
  schema: { safeParse(value: unknown): { success: false } | { success: true; data: T } }
): T | null => {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
const linkOptionsSchema = z
  .object({
    foreignTableId: z.string().optional(),
    symmetricFieldId: z.string().optional(),
    lookupFieldId: z.string().optional(),
    visibleFieldIds: z.array(z.string()).optional(),
    relationship: z.string().optional(),
    fkHostTableName: z.string().optional(),
    foreignKeyName: z.string().optional(),
    selfKeyName: z.string().optional(),
    linkFieldId: z.string().optional(),
  })
  .passthrough();
const viewOptionsSchema = z
  .object({
    frozenFieldId: z.string().nullish(),
    stackFieldId: z.string().nullish(),
    coverFieldId: z.string().nullish(),
    startDateFieldId: z.string().nullish(),
    endDateFieldId: z.string().nullish(),
    titleFieldId: z.string().nullish(),
    colorConfig: z
      .object({ type: z.string().optional(), fieldId: z.string().optional() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

class LinkFieldReadVisitor extends NoopFieldVisitor {
  link: LinkField | undefined;

  override visitLinkField(field: LinkField): Result<void, DomainError> {
    this.link = field;
    return ok(undefined);
  }
}

const readLinkField = (field: Field): LinkField | undefined => {
  const visitor = new LinkFieldReadVisitor();
  unwrap(field.accept(visitor));
  return visitor.link;
};

/** Uses the native dependency graph; source labels and view configuration are host metadata. */
@Injectable()
export class FieldDependencyReadService {
  private readonly logger = new Logger(FieldDependencyReadService.name);
  constructor(
    private readonly prismaService: PrismaService,
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    @ThresholdConfig() private readonly threshold: IThresholdConfig
  ) {}

  private async load(tableId: string, fieldIds: string[]) {
    const container = await this.containers.getContainerForTable(tableId);
    const context = await this.contexts.createContext(container);
    const repository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const table = unwrap(
      await repository.findOne(context, TableByIdSpec.create(unwrap(TableId.create(tableId))))
    );
    const seeds = new Set(fieldIds);
    for (const fieldId of fieldIds) {
      const field = table.getField((field) => field.id().toString() === fieldId);
      const link = field.isOk() ? readLinkField(field.value) : undefined;
      if (link) {
        const symmetricFieldId = link.symmetricFieldId();
        if (symmetricFieldId) seeds.add(symmetricFieldId.toString());
      }
    }
    const ids = [...seeds].map((id) => unwrap(FieldId.create(id)));
    const graph = unwrap(
      await container
        .resolve<FieldDependencyGraph>(v2RecordRepositoryPostgresTokens.computedDependencyGraph)
        .load(table.baseId(), context, { requiredFieldIds: ids })
    );
    return { table, graph, context, container };
  }

  private async sources(tableIds: string[]) {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { id: { in: tableIds }, deletedTime: null },
      select: { id: true, name: true, icon: true, baseId: true },
    });
    const bases = await this.prismaService.base.findMany({
      where: { id: { in: [...new Set(tables.map((table) => table.baseId))] } },
      select: { id: true, name: true, icon: true },
    });
    const byId = new Map(bases.map((base) => [base.id, base]));
    const result = new Map<string, IFieldDeleteRefTableSource>();
    for (const table of tables) {
      const base = byId.get(table.baseId);
      if (base)
        result.set(table.id, {
          id: table.id,
          name: table.name,
          icon: table.icon,
          base: { id: base.id, name: baseDisplayName(base.name), icon: base.icon },
        });
    }
    return result;
  }

  async hydrateFields(ids: string[]): Promise<IFieldDeleteRefDependentField[]> {
    if (!ids.length) return [];
    const fields = await this.prismaService.field.findMany({
      where: { id: { in: ids }, deletedTime: null },
      select: { id: true, name: true, type: true, tableId: true },
    });
    const sources = await this.sources([...new Set(fields.map((field) => field.tableId))]);
    return fields.flatMap((field) => {
      const source = sources.get(field.tableId);
      return source ? [{ id: field.id, name: field.name, type: field.type, source }] : [];
    });
  }

  private viewReferences(
    view: {
      filter: string | null;
      sort: string | null;
      group: string | null;
      options: string | null;
      type: string;
    },
    fieldId: string
  ) {
    const filter = parse(view.filter, filterSchema);
    if (filter) {
      try {
        if (extractFieldIdsFromFilter(filter, true).includes(fieldId)) return true;
      } catch {
        /* Historical malformed filter does not hide the other view properties. */
      }
    }
    if (parse(view.sort, sortSchema)?.sortObjs.some((item) => item.fieldId === fieldId))
      return true;
    const group = parse(view.group, groupSchema);
    if (group?.some((item) => item.fieldId === fieldId)) return true;
    const options = parse(view.options, viewOptionsSchema);
    if (!options) return false;
    const keys: Record<string, string[]> = {
      grid: ['frozenFieldId'],
      kanban: ['stackFieldId', 'coverFieldId'],
      gallery: ['coverFieldId'],
      calendar: ['startDateFieldId', 'endDateFieldId', 'titleFieldId'],
    };
    if ((keys[view.type] ?? []).some((key) => options[key] === fieldId)) return true;
    const color = options.colorConfig;
    return view.type === 'calendar' && color?.type === 'field' && color.fieldId === fieldId;
  }

  async getDeleteFieldReferences(
    tableId: string,
    fieldIds: string[]
  ): Promise<IFieldDeleteReferencesVo> {
    const result: IFieldDeleteReferencesVo = Object.fromEntries(
      fieldIds.map((id) => [
        id,
        { workflowNodes: [], authorityMatrixRoles: [], views: [], dependentFields: [] },
      ])
    );
    if (!fieldIds.length) return result;
    const rawFields = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, type: true, options: true },
    });
    const validIds = fieldIds.filter((id) => rawFields.some((field) => field.id === id));
    const views = await this.prismaService.view.findMany({
      where: { tableId, deletedTime: null },
      select: {
        id: true,
        name: true,
        type: true,
        filter: true,
        sort: true,
        group: true,
        options: true,
      },
    });
    const source = (await this.sources([tableId])).get(tableId);
    for (const id of fieldIds)
      if (source)
        result[id].views = views
          .filter((view) => this.viewReferences(view, id))
          .map((view) => ({ id: view.id, name: view.name, type: view.type, source }));
    if (!validIds.length) return result;
    const { graph, container } = await this.load(tableId, validIds);
    const dependencies = new Map(validIds.map((id) => [id, new Set<string>()]));
    const deleting = new Set(fieldIds);
    const add = (from: string, to: string) => {
      if (!deleting.has(to)) dependencies.get(from)?.add(to);
    };
    for (const edge of graph.edges) add(edge.fromFieldId.toString(), edge.toFieldId.toString());
    for (const field of rawFields) {
      const symmetric =
        field.type === FieldType.Link
          ? parse(field.options, linkOptionsSchema)?.symmetricFieldId
          : undefined;
      if (symmetric) add(field.id, symmetric);
    }
    // Link display selections are host-facing metadata, independent of computation propagation.
    const metaDb = container.resolve<Kysely<V1TeableDatabase>>(v2MetaDbTokens.db);
    const externalLinks = await metaDb
      .selectFrom('field')
      .select(['id', 'options'])
      .where('type', '=', FieldType.Link)
      .where('deleted_time', 'is', null)
      .where('table_id', '!=', tableId)
      .where(sql<string>`options::jsonb ->> 'foreignTableId'`, '=', tableId)
      .execute();
    for (const field of externalLinks) {
      const options = parse(field.options, linkOptionsSchema);
      if (options?.foreignTableId !== tableId) continue;
      if (options.lookupFieldId) add(options.lookupFieldId, field.id);
      for (const id of options.visibleFieldIds ?? []) add(id, field.id);
    }
    const hydrated = new Map(
      (
        await this.hydrateFields([
          ...new Set([...dependencies.values()].flatMap((ids) => [...ids])),
        ])
      ).map((field) => [field.id, field])
    );
    for (const [id, ids] of dependencies)
      result[id].dependentFields = [...ids].flatMap((id) => {
        const field = hydrated.get(id);
        return field ? [field] : [];
      });
    return result;
  }

  async getDeleteTableReferences(
    baseId: string,
    tableId: string
  ): Promise<ITableDeleteReferencesVo> {
    const container = await this.containers.getContainerForBase(baseId);
    const context = await this.contexts.createContext(container);
    const command = unwrap(DeleteTableCommand.create({ baseId, tableId, mode: 'soft' }));
    const prepared = unwrap(
      await container
        .resolve<TableDeletionPreparationService>(v2CoreTokens.tableDeletionPreparationService)
        .prepare(context, command)
    );
    const sourceFieldIds = prepared.table.getFields().map((field) => field.id());
    const sourceIds = new Set(sourceFieldIds.map((id) => id.toString()));
    const graph = unwrap(
      await container
        .resolve<FieldDependencyGraph>(v2RecordRepositoryPostgresTokens.computedDependencyGraph)
        .load(prepared.table.baseId(), context, { requiredFieldIds: sourceFieldIds })
    );
    const dependentIds = new Set(
      prepared.sideEffects.reactionEffects.map((effect) => effect.fieldId)
    );
    for (const edge of graph.edges) {
      if (
        sourceIds.has(edge.fromFieldId.toString()) &&
        !edge.toTableId.equals(prepared.table.id())
      ) {
        dependentIds.add(edge.toFieldId.toString());
      }
    }
    return { dependentFields: await this.hydrateFields([...dependentIds]) };
  }

  async planField(tableId: string, fieldId: string): Promise<IPlanFieldVo> {
    const { table, graph } = await this.load(tableId, [fieldId]);
    const ids = new Set<string>([
      fieldId,
      ...graph.fieldsById.keys(),
      ...graph.edges.flatMap((edge) => [edge.fromFieldId.toString(), edge.toFieldId.toString()]),
    ]);
    const fields = await this.prismaService.field.findMany({
      where: { id: { in: [...ids] }, deletedTime: null },
      select: {
        id: true,
        name: true,
        tableId: true,
        type: true,
        isLookup: true,
        isConditionalLookup: true,
        options: true,
        lookupOptions: true,
      },
    });
    const tables = await this.prismaService.tableMeta.findMany({
      where: { id: { in: [...new Set(fields.map((field) => field.tableId))] }, deletedTime: null },
      select: { id: true, name: true, dbTableName: true },
    });
    const names = new Map(tables.map((table) => [table.id, table.dbTableName]));
    const edges = graph.edges.filter((edge) => edge.semantic !== 'lookup_link');
    const selected = readLinkField(
      unwrap(table.getField((field) => field.id().toString() === fieldId))
    );
    if (selected) {
      const symmetric = selected.symmetricFieldId();
      if (symmetric && graph.fieldsById.has(symmetric.toString())) {
        edges.push({
          fromFieldId: selected.id(),
          toFieldId: symmetric,
          fromTableId: table.id(),
          toTableId: selected.foreignTableId(),
          kind: 'cross_record',
        });
        for (const edge of graph.edges) {
          if (edge.semantic === 'lookup_link' && edge.fromFieldId.equals(symmetric)) {
            edges.push({
              ...edge,
              fromFieldId: selected.id(),
              fromTableId: table.id(),
              semantic: undefined,
            });
          }
        }
      }
    }
    const seen = new Set<string>();
    const visible = new Set<string>([fieldId]);
    const displayEdges = edges.flatMap((edge) => {
      const source = edge.fromFieldId.toString();
      const target = edge.toFieldId.toString();
      const key = `${source}->${target}`;
      if (seen.has(key)) return [];
      seen.add(key);
      visible.add(source);
      visible.add(target);
      const field = fields.find((field) => field.id === target);
      return [{ source, target, label: field?.isLookup ? 'lookup' : field?.type }];
    });
    let updateCellCount = 0;
    for (const field of fields) {
      const options =
        field.id !== fieldId
          ? field.type === FieldType.Link
            ? parse(field.options, linkOptionsSchema)
            : parse(field.lookupOptions, linkOptionsSchema)
          : null;
      const linkOptions =
        options?.fkHostTableName &&
        options.foreignKeyName &&
        (field.type === FieldType.Link || options.linkFieldId)
          ? options
          : null;
      const physical = linkOptions?.fkHostTableName ?? names.get(field.tableId);
      if (!physical) continue;
      const container = await this.containers.getContainerForTable(field.tableId);
      const db = container.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
      const count = linkOptions
        ? linkOptions.relationship === 'oneOne' || linkOptions.relationship === 'manyOne'
          ? sql`count(${sql.ref(linkOptions.foreignKeyName!)})`
          : linkOptions.selfKeyName
            ? sql`count(distinct ${sql.ref(linkOptions.selfKeyName)})`
            : null
        : sql`count(*)`;
      if (!count) continue;
      try {
        const rows = await sql<{
          count: string;
        }>`select ${count} as count from ${sql.table(physical)}`.execute(db);
        updateCellCount += Number(rows.rows[0]?.count ?? 0);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (code !== '42703' && code !== '42P01') throw error;
        this.logger.warn(`Skip affected cell count for field=${field.id} due to broken storage`);
      }
    }
    return {
      updateCellCount,
      estimateTime: Math.floor(updateCellCount / this.threshold.estimateCalcCelPerMs),
      graph: {
        nodes: fields
          .filter((field) => visible.has(field.id))
          .map((field) => ({
            id: field.id,
            label: field.name,
            comboId: field.tableId,
            fieldType: field.type,
            isLookup: field.isLookup,
            isConditionalLookup: field.isConditionalLookup,
            isSelected: field.id === fieldId,
          })),
        edges: displayEdges,
        combos: tables.map((table) => ({ id: table.id, label: table.name })),
      },
    };
  }

  async planDeleteField(tableId: string, fieldId: string) {
    const plan = await this.planField(tableId, fieldId);
    const references = await this.getDeleteFieldReferences(tableId, [fieldId]);
    const links = await this.prismaService.field.findMany({
      where: {
        id: { in: references[fieldId].dependentFields.map((field) => field.id) },
        type: FieldType.Link,
        OR: [{ isLookup: null }, { isLookup: false }],
        deletedTime: null,
      },
      select: { options: true },
    });
    const linkFieldCount = links.filter((field) => {
      const options = parse(field.options, linkOptionsSchema);
      return options?.foreignTableId === tableId && options.lookupFieldId === fieldId;
    }).length;
    return { ...plan, linkFieldCount };
  }
}
