import { Readable } from 'node:stream';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  IColumnMetaRo,
  IFieldRo,
  IFilter,
  ILinkFieldOptions,
  IUserFieldOptions,
  IViewOptions,
  ViewType,
  CellValueType,
} from '@teable/core';
import { FieldAIActionType, FieldKeyType, FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IImportAirtableAnalyzeRo,
  IImportAirtableAnalyzeVo,
  IImportAirtableIssue,
  IImportAirtableRo,
  IImportAirtableVo,
} from '@teable/openapi';
import { CollaboratorType, PrincipalType, UploadType } from '@teable/openapi';
import { AiService } from '../ai/ai.service';
import { AttachmentsService } from '../attachments/attachments.service';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { BaseService } from '../base/base.service';
import { FieldOpenApiV2Service } from '../field/open-api/field-open-api-v2.service';
import { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import { TableOpenApiV2Service } from '../table/open-api/table-open-api-v2.service';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { AirtableApiClient, AirtableIteratorExpiredError } from './airtable-api.client';
import { AirtableLinkRowSpill, type ISpilledLinkRow } from './airtable-link-spill';
import {
  convertAirtableCellValue,
  convertCollaboratorCellValue,
  extractLinkedRecordIds,
  type IResolvedSpaceUser,
} from './airtable-record-converter';
import type {
  IAirtableImportPlan,
  IAirtableTablePlan,
  IPlannedDirectField,
  IPlannedFormulaField,
  IPlannedLinkField,
} from './airtable-schema-mapper';
import { buildAirtableImportPlan } from './airtable-schema-mapper';
import { AirtableShareClient, AirtableShareError } from './airtable-share.client';
import {
  AIRTABLE_IMPORT_TOKEN_RESOLVER,
  type IAirtableImportTokenResolver,
} from './airtable-token-resolver';
import {
  mapAirtableFilter,
  mapAirtableViewConfig,
  type IImportFieldMeta,
  type IViewConfigMapperContext,
} from './airtable-view-config-mapper';
import type { IAirtableAttachment, IAirtableRecord, IAirtableTable } from './airtable.types';

export interface IAirtableImportProgress {
  phase: string;
  detail?: string;
  tableName?: string;
  tableIndex?: number;
  totalTables?: number;
  processedRows?: number;
}

export type IAirtableImportProgressReporter = (progress: IAirtableImportProgress) => void;

const linkUpdateBatchSize = 100;
const attachmentConcurrency = 3;
const maxListRestarts = 2;
const unknownErrorText = 'unknown error';

interface ILinkFieldRuntime {
  plan: IPlannedLinkField;
  tableAirtableId: string;
  relationship: Relationship;
}

/** A created Teable view paired with the Airtable view its config comes from. */
interface IViewConfigTarget {
  airtableViewId: string;
  teableViewId: string;
  teableViewType: ViewType;
  tableId: string;
  tableName: string;
  viewName: string;
}

/** Runs tasks with bounded concurrency, preserving the result order. */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

@Injectable()
export class AirtableImportService {
  private readonly logger = new Logger(AirtableImportService.name);

  constructor(
    private readonly baseService: BaseService,
    private readonly tableOpenApiV2Service: TableOpenApiV2Service,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    private readonly fieldOpenApiV2Service: FieldOpenApiV2Service,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly attachmentsService: AttachmentsService,
    private readonly prismaService: PrismaService,
    private readonly aiService: AiService,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @Optional()
    @Inject(AIRTABLE_IMPORT_TOKEN_RESOLVER)
    private readonly tokenResolver?: IAirtableImportTokenResolver
  ) {}

  /**
   * Stages link-cell spill parts in the deployment's blob storage
   * (local/S3/MinIO), mirroring how the .tea import streams its data files —
   * no container-local temp files.
   */
  private createLinkSpill(): AirtableLinkRowSpill {
    const bucket = StorageAdapter.getBucket(UploadType.Import);
    return new AirtableLinkRowSpill({
      upload: async (path, data) => {
        await this.storageAdapter.uploadFileStream(bucket, path, data);
      },
      download: async (path) => {
        const stream = await this.storageAdapter.downloadFile(bucket, path);
        return stream instanceof Readable
          ? stream
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Readable.fromWeb(stream as any);
      },
      cleanup: async (dir) => {
        await this.storageAdapter.deleteDir(bucket, dir);
      },
    });
  }

  /**
   * Builds the per-request access token provider. With an integrationId the
   * token stays server-side and is refreshed by the resolver; a raw
   * accessToken (direct API usage) is used as-is.
   */
  private createClient(ro: { integrationId?: string; accessToken?: string }): AirtableApiClient {
    if (ro.integrationId) {
      const resolver = this.tokenResolver;
      if (!resolver) {
        throw new BadRequestException('Airtable integrations are not available on this instance');
      }
      const integrationId = ro.integrationId;
      return new AirtableApiClient(() => resolver.resolveAccessToken(integrationId));
    }
    if (!ro.accessToken) {
      throw new BadRequestException('Either integrationId or accessToken is required');
    }
    const accessToken = ro.accessToken;
    return new AirtableApiClient(() => accessToken);
  }

  async analyze(ro: IImportAirtableAnalyzeRo): Promise<IImportAirtableAnalyzeVo> {
    const client = this.createClient(ro);
    if (!ro.airtableBaseId) {
      const bases = await client.listBases();
      return {
        bases: bases
          .filter((base) => base.permissionLevel !== 'none')
          .map(({ id, name, permissionLevel }) => ({ id, name, permissionLevel })),
      };
    }

    const tables = await client.getBaseSchema(ro.airtableBaseId);
    const plan = buildAirtableImportPlan(tables);
    return {
      base: {
        id: ro.airtableBaseId,
        tables: tables.map((table) => ({
          id: table.id,
          name: table.name,
          fieldCount: table.fields.length,
          viewCount: table.views.length,
        })),
        issues: plan.issues,
      },
    };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- orchestrates the linear import pipeline
  async importBase(
    ro: IImportAirtableRo,
    onProgress?: IAirtableImportProgressReporter
  ): Promise<IImportAirtableVo> {
    const importRecords = ro.importRecords ?? true;
    const importAttachments = ro.importAttachments ?? true;
    const importViewConfig = ro.importViewConfig === true;
    const progress = (event: IAirtableImportProgress) => onProgress?.(event);
    const client = this.createClient(ro);
    const startedAt = Date.now();

    progress({ phase: 'fetching_schema' });
    const airtableTables = await client.getBaseSchema(ro.airtableBaseId);
    this.logger.log(
      `[airtable-import] start airtableBase=${ro.airtableBaseId} target=${ro.baseId ?? 'new'} ` +
        `tables=${airtableTables.length} source=${ro.integrationId ? 'integration' : 'pat'} ` +
        `records=${importRecords} attachments=${importAttachments} viewConfig=${importViewConfig}`
    );

    // Resolve and validate the shared-base link up front (fail fast on a wrong or
    // private link) and read the base model it unlocks, which carries the rollup
    // aggregations the official API never exposes — so rollups can be recreated
    // live instead of snapshotted.
    const shareClient = importViewConfig ? await this.resolveShareClient(ro) : undefined;
    const rollupSources = shareClient ? await shareClient.fetchApplicationModel() : undefined;

    const plan = buildAirtableImportPlan(airtableTables, rollupSources);
    const issues: IImportAirtableIssue[] = [...plan.issues];
    const totalTables = plan.tables.length;

    // Import into an existing base (adding its tables) or create a fresh one.
    // spaceId is only needed to create a new base; for an existing base the
    // base's own space is used (see user-field resolution below).
    let base;
    if (ro.baseId) {
      base = await this.baseService.getBaseById(ro.baseId);
    } else {
      if (!ro.spaceId) {
        throw new BadRequestException('spaceId is required when baseId is not provided.');
      }
      progress({ phase: 'creating_base', detail: ro.baseName });
      base = await this.baseService.createBase({
        spaceId: ro.spaceId,
        name: ro.baseName ?? 'Imported base',
      });
    }
    const aiModelKey = await this.resolveAiModelKey(base.id);

    // airtable table id -> created teable table id
    const tableIdMap: Record<string, string> = {};
    const tableViewIds: Record<string, string[]> = {};
    // airtable view id -> created teable view id; used for a link's
    // "limit record selection to a view", regardless of importViewConfig.
    const viewIdMap: Record<string, string> = {};
    const viewTargets: IViewConfigTarget[] = [];
    for (const [index, tablePlan] of plan.tables.entries()) {
      progress({
        phase: 'creating_table',
        tableName: tablePlan.name,
        tableIndex: index + 1,
        totalTables,
      });
      const table = await this.tableOpenApiV2Service.createTable(base.id, {
        name: tablePlan.name,
        description: tablePlan.description,
        fieldKeyType: FieldKeyType.Id,
        fields: tablePlan.fields.map((field) =>
          this.applyAiConfig(field, aiModelKey, plan.fieldIdMap, tablePlan.name, issues)
        ),
        views: tablePlan.views,
        records: [],
      });
      tableIdMap[tablePlan.airtableTableId] = table.id;
      tableViewIds[table.id] = (table.views ?? []).map((view) => view.id);
      tablePlan.viewSources.forEach((source, viewIndex) => {
        const createdView = (table.views ?? [])[viewIndex];
        if (createdView?.type === source.teableViewType) {
          viewIdMap[source.airtableViewId] = createdView.id;
        }
      });
      if (importViewConfig) {
        this.collectViewTargets(tablePlan, table.id, table.views ?? [], viewTargets);
      }
    }

    // Complete the table structure before data with link fields only — they
    // follow the relationship Airtable declares. Derived fields (lookups,
    // counts) and view configuration are applied AFTER the records, so a field
    // that cannot be computed degrades to a reported issue instead of breaking
    // record/link writes and aborting the whole import.
    progress({ phase: 'creating_links' });
    const linkRuntimes = await this.createLinkFields({ plan, tableIdMap, viewIdMap, issues });

    // Memory bounds for large bases: record pages, inserts, attachment
    // transfers and link writes are all streamed/batched. The only data kept
    // for the whole run is the old->new record id map of tables that links
    // point at (needed to remap link cells); buffered link rows spill to the
    // blob storage.
    const linkTargetTables = new Set(
      plan.tables.flatMap((table) => table.linkFields.map((link) => link.airtableForeignTableId))
    );
    const recordIdMaps = new Map<string, Map<string, string>>();
    // Single-link fields whose data turned out to hold several links — relaxed
    // to many-to-many before fill so no link is dropped (Airtable's single-link
    // is a soft per-cell preference, not an enforced 1:1).
    const linkFieldsWithMulti = new Set<string>();
    const linkSpill = this.createLinkSpill();

    try {
      if (importRecords) {
        // Resolve user fields against the base's actual space, not ro.spaceId —
        // for an existing-base import the two can differ (ro.spaceId is optional
        // there), and the base's members are the correct mapping target.
        const usersByEmail = await this.getSpaceUsersByEmail(base.spaceId);
        for (const [index, tablePlan] of plan.tables.entries()) {
          await this.importTableRecords({
            client,
            ro,
            tablePlan,
            tableIndex: index + 1,
            totalTables,
            tableId: tableIdMap[tablePlan.airtableTableId],
            usersByEmail,
            importAttachments,
            recordIdMaps,
            linkSpill,
            linkFieldsWithMulti,
            issues,
            progress,
          });
          if (!linkTargetTables.has(tablePlan.airtableTableId)) {
            // The map was only needed for in-table restart deduplication.
            recordIdMaps.delete(tablePlan.airtableTableId);
          }
        }

        await this.relaxOversizedSingleLinks({
          plan,
          linkRuntimes,
          linkFieldsWithMulti,
          tableIdMap,
          issues,
        });

        await this.fillLinkValues({
          plan,
          tableIdMap,
          linkRuntimes,
          recordIdMaps,
          linkSpill,
          issues,
          progress,
        });
      }
    } finally {
      await linkSpill.cleanup();
    }

    // Derived fields are computed over the imported data; create them last so a
    // single uncomputable field is reported, never fatal to the whole import.
    await this.createLookupFields(plan, tableIdMap, issues);
    await this.createCountFields(plan, tableIdMap, issues);
    await this.createRollupFields(plan, tableIdMap, airtableTables, issues);
    await this.createFormulaFields(plan, tableIdMap, issues);

    // Restore Airtable's field order: links and derived fields are created in
    // later phases and would otherwise sit at the end. Rewrite each view's
    // column order to the source table's field order so the layout matches.
    await this.reorderFields({
      airtableTables,
      tableIdMap,
      tableViewIds,
      fieldIdMap: plan.fieldIdMap,
    });

    // View configuration last: every field now exists, so sorts/groups that
    // reference a lookup or count resolve too.
    if (shareClient) {
      await this.applyViewConfigs({
        shareClient,
        airtableTables,
        plan,
        viewTargets,
        issues,
        progress,
      });
    }

    this.logImportOutcome(ro, base.id, tableIdMap, plan.fieldIdMap, issues, startedAt);
    progress({ phase: 'import_done', detail: base.name });
    return {
      base,
      tableIdMap,
      fieldIdMap: plan.fieldIdMap,
      issues,
    };
  }

  /**
   * Emits structured, collectable logs of an import's outcome: one summary line
   * (counts + issue breakdown + duration) and one line per issue (which field /
   * view degraded or was skipped, and why). Skips are `warn`, degrades are `log`,
   * so a log pipeline can alert on the former and aggregate both by type/reason.
   */
  /**
   * Restores the source field order. Plain fields are created in order with the
   * table, but links and derived fields (lookup/count/rollup/formula) are added
   * in later phases and land at the end; this rewrites every view's column order
   * to the Airtable table's field order. Best-effort — a failure is logged, not
   * fatal, since the data is already imported.
   */
  private async reorderFields(params: {
    airtableTables: IAirtableTable[];
    tableIdMap: Record<string, string>;
    tableViewIds: Record<string, string[]>;
    fieldIdMap: Record<string, string>;
  }): Promise<void> {
    const { airtableTables, tableIdMap, tableViewIds, fieldIdMap } = params;
    for (const airtableTable of airtableTables) {
      const tableId = tableIdMap[airtableTable.id];
      const viewIds = tableViewIds[tableId] ?? [];
      if (!tableId || viewIds.length === 0) continue;
      const columnMetaRo = airtableTable.fields
        .map((field) => fieldIdMap[field.id])
        .filter((id): id is string => Boolean(id))
        .map((fieldId, order) => ({ fieldId, columnMeta: { order } }));
      if (columnMetaRo.length === 0) continue;
      for (const viewId of viewIds) {
        try {
          await this.viewOpenApiService.updateViewColumnMeta(
            tableId,
            viewId,
            columnMetaRo as IColumnMetaRo
          );
        } catch (error) {
          this.logger.warn(
            `[airtable-import] reorder failed for ${airtableTable.name}: ${
              error instanceof Error ? error.message : 'error'
            }`
          );
        }
      }
    }
  }

  private logImportOutcome(
    ro: IImportAirtableRo,
    baseId: string,
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    issues: IImportAirtableIssue[],
    startedAt: number
  ): void {
    const byCode = issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.code] = (acc[issue.code] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(
      `[airtable-import] done base=${baseId} airtableBase=${ro.airtableBaseId} ` +
        `tables=${Object.keys(tableIdMap).length} fields=${Object.keys(fieldIdMap).length} ` +
        `issues=${issues.length} byCode=${JSON.stringify(byCode)} durationMs=${Date.now() - startedAt}`
    );
    for (const issue of issues) {
      const target = `${issue.tableName}/${issue.fieldName ?? issue.viewName ?? '?'}`;
      const change = issue.toType ? ` -> ${issue.toType}` : issue.reason ? `: ${issue.reason}` : '';
      const line = `[airtable-import] ${issue.code} base=${baseId} ${target} (from=${issue.fromType ?? '?'}${change})`;
      if (issue.code === 'fieldSkipped' || issue.code === 'viewSkipped') {
        this.logger.warn(line);
      } else {
        this.logger.log(line);
      }
    }
  }

  /**
   * Resolves the AI model used for imported Airtable aiText fields from the
   * base's AI configuration (space integration or instance settings). Returns
   * undefined when no AI model is configured.
   */
  private async resolveAiModelKey(baseId: string): Promise<string | undefined> {
    try {
      const config = await this.aiService.getAIConfig(baseId);
      return config.chatModel?.lg || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Turns an Airtable aiText field into a Teable AI field (custom prompt with
   * field references) when an AI model is available; otherwise keeps the
   * plain long-text snapshot and reports the degradation.
   */
  private applyAiConfig(
    planned: IPlannedDirectField,
    aiModelKey: string | undefined,
    fieldIdMap: Record<string, string>,
    tableName: string,
    issues: IImportAirtableIssue[]
  ): IFieldRo {
    if (!planned.aiPromptParts) {
      return planned.ro;
    }
    const prompt = planned.aiPromptParts
      .map((part) => {
        if (part.text != null) return part.text;
        const teableFieldId = part.airtableFieldId && fieldIdMap[part.airtableFieldId];
        if (teableFieldId) return `{${teableFieldId}}`;
        return part.fieldName ?? '';
      })
      .join('');

    if (!aiModelKey || !prompt.trim()) {
      issues.push({
        code: 'fieldDegraded',
        tableName,
        fieldName: planned.ro.name as string,
        fromType: 'aiText',
        toType: 'longText snapshot',
        reason: aiModelKey ? 'the AI prompt is empty' : 'no AI model is configured',
      });
      return planned.ro;
    }

    return {
      ...planned.ro,
      aiConfig: {
        type: FieldAIActionType.Customization,
        modelKey: aiModelKey,
        prompt,
        // Keep imported snapshot values; users can enable auto-fill later to
        // avoid triggering a generation for every imported record.
        isAutoFill: false,
      },
    } as IFieldRo;
  }

  private async resolveShareClient(ro: IImportAirtableRo): Promise<AirtableShareClient> {
    const shareClient = new AirtableShareClient();
    try {
      await shareClient.resolveShare(ro.shareLink ?? '');
      shareClient.assertBaseMatch(ro.airtableBaseId);
    } catch (error) {
      if (error instanceof AirtableShareError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return shareClient;
  }

  /**
   * Pairs each created Teable view with the Airtable view it came from. The v2
   * create-table mapper preserves view order, so the i-th created view matches
   * the i-th planned source; the type guard skips any unexpected drift.
   */
  private collectViewTargets(
    tablePlan: IAirtableTablePlan,
    tableId: string,
    createdViews: Array<{ id: string; type: ViewType; name: string }>,
    targets: IViewConfigTarget[]
  ) {
    tablePlan.viewSources.forEach((source, index) => {
      const created = createdViews[index];
      if (!created || created.type !== source.teableViewType) return;
      targets.push({
        airtableViewId: source.airtableViewId,
        teableViewId: created.id,
        teableViewType: source.teableViewType,
        tableId,
        tableName: tablePlan.name,
        viewName: (tablePlan.views[index]?.name as string) ?? created.name,
      });
    });
  }

  /**
   * Reads each view's configuration from the shared base and applies the mapped
   * filter/sort/grouping/options. Every view and every aspect is isolated so a
   * single failure degrades to an issue without affecting the rest.
   */
  private async applyViewConfigs(params: {
    shareClient: AirtableShareClient;
    airtableTables: IAirtableTable[];
    plan: IAirtableImportPlan;
    viewTargets: IViewConfigTarget[];
    issues: IImportAirtableIssue[];
    progress: (event: IAirtableImportProgress) => void;
  }) {
    const { shareClient, airtableTables, plan, viewTargets, issues, progress } = params;
    if (viewTargets.length === 0) return;
    progress({ phase: 'applying_view_config' });

    const optionNames = this.buildSelectOptionNames(airtableTables);
    const fieldMetaByTable = new Map<string, Map<string, IImportFieldMeta>>();

    for (const target of viewTargets) {
      try {
        const config = await shareClient.fetchViewConfig(target.airtableViewId);
        let metaMap = fieldMetaByTable.get(target.tableId);
        if (!metaMap) {
          metaMap = await this.fetchFieldMeta(target.tableId);
          fieldMetaByTable.set(target.tableId, metaMap);
        }
        const ctx: IViewConfigMapperContext = {
          resolveField: (columnId) => {
            const teableFieldId = plan.fieldIdMap[columnId];
            return teableFieldId ? metaMap?.get(teableFieldId) : undefined;
          },
          resolveSelectOptionName: (columnId, optionId) => optionNames.get(columnId)?.get(optionId),
        };
        const mapped = mapAirtableViewConfig({
          teableViewType: target.teableViewType,
          config,
          ctx,
          tableName: target.tableName,
          viewName: target.viewName,
          issues,
        });
        await this.applyMappedViewConfig(target, mapped, issues);
      } catch (error) {
        this.logger.warn(
          `Failed to import view config for "${target.viewName}": ${
            error instanceof Error ? error.message : unknownErrorText
          }`
        );
        issues.push({
          code: 'viewConfigDegraded',
          tableName: target.tableName,
          viewName: target.viewName,
          reason: 'could not read the view configuration from the shared base',
        });
      }
    }
  }

  private async applyMappedViewConfig(
    target: IViewConfigTarget,
    mapped: ReturnType<typeof mapAirtableViewConfig>,
    issues: IImportAirtableIssue[]
  ) {
    const apply = async (label: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        this.logger.warn(
          `Failed to apply ${label} to view "${target.viewName}": ${
            error instanceof Error ? error.message : unknownErrorText
          }`
        );
        issues.push({
          code: 'viewConfigDegraded',
          tableName: target.tableName,
          viewName: target.viewName,
          reason: `could not apply ${label}`,
        });
      }
    };

    if (mapped.filter) {
      await apply('filters', () =>
        this.viewOpenApiService.setViewProperty(
          target.tableId,
          target.teableViewId,
          'filter',
          mapped.filter
        )
      );
    }
    if (mapped.sort) {
      await apply('sorting', () =>
        this.viewOpenApiService.setViewProperty(
          target.tableId,
          target.teableViewId,
          'sort',
          mapped.sort
        )
      );
    }
    if (mapped.group) {
      await apply('grouping', () =>
        this.viewOpenApiService.setViewProperty(
          target.tableId,
          target.teableViewId,
          'group',
          mapped.group
        )
      );
    }
    if (mapped.options) {
      await apply('view options', () =>
        this.viewOpenApiService.patchViewOptions(
          target.tableId,
          target.teableViewId,
          mapped.options as IViewOptions
        )
      );
    }
  }

  /** airtable select field id -> (option id -> option name) for filter mapping. */
  private buildSelectOptionNames(tables: IAirtableTable[]): Map<string, Map<string, string>> {
    const map = new Map<string, Map<string, string>>();
    const selectFields = tables.flatMap((table) =>
      table.fields.filter(
        (field) => field.type === 'singleSelect' || field.type === 'multipleSelects'
      )
    );
    for (const field of selectFields) {
      const choices = field.options?.choices;
      if (!Array.isArray(choices)) continue;
      const byId = new Map<string, string>();
      for (const choice of choices) {
        // Trimmed to match the created Teable option names (see mapSelectChoices).
        if (choice?.id && typeof choice.name === 'string') byId.set(choice.id, choice.name.trim());
      }
      map.set(field.id, byId);
    }
    return map;
  }

  private async fetchFieldMeta(tableId: string): Promise<Map<string, IImportFieldMeta>> {
    const fields = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, type: true, cellValueType: true, isMultipleCellValue: true },
    });
    return new Map(
      fields.map((field) => [
        field.id,
        {
          fieldId: field.id,
          type: field.type as FieldType,
          cellValueType: field.cellValueType as CellValueType,
          isMultipleCellValue: field.isMultipleCellValue === true,
        },
      ])
    );
  }

  private async getSpaceUsersByEmail(spaceId: string): Promise<Map<string, IResolvedSpaceUser>> {
    const collaborators = await this.prismaService.collaborator.findMany({
      where: {
        resourceId: spaceId,
        resourceType: CollaboratorType.Space,
        principalType: PrincipalType.User,
      },
      select: { principalId: true },
    });
    if (collaborators.length === 0) {
      return new Map();
    }
    const users = await this.prismaService.user.findMany({
      where: {
        id: { in: collaborators.map(({ principalId }) => principalId) },
        deletedTime: null,
      },
      select: { id: true, name: true, email: true },
    });
    return new Map(
      users.map((user) => [
        user.email.toLowerCase(),
        { id: user.id, name: user.name, email: user.email },
      ])
    );
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async importTableRecords(params: {
    client: AirtableApiClient;
    ro: IImportAirtableRo;
    tablePlan: IAirtableTablePlan;
    tableIndex: number;
    totalTables: number;
    tableId: string;
    usersByEmail: Map<string, IResolvedSpaceUser>;
    importAttachments: boolean;
    recordIdMaps: Map<string, Map<string, string>>;
    linkSpill: AirtableLinkRowSpill;
    linkFieldsWithMulti: Set<string>;
    issues: IImportAirtableIssue[];
    progress: (event: IAirtableImportProgress) => void;
  }) {
    const {
      client,
      ro,
      tablePlan,
      tableIndex,
      totalTables,
      tableId,
      usersByEmail,
      importAttachments,
      recordIdMaps,
      linkSpill,
      linkFieldsWithMulti,
      issues,
      progress,
    } = params;

    progress({
      phase: 'table_records_start',
      tableName: tablePlan.name,
      tableIndex,
      totalTables,
    });

    const recordIdMap = new Map<string, string>();
    recordIdMaps.set(tablePlan.airtableTableId, recordIdMap);
    const droppedCollaborators = new Map<string, number>();
    const failedAttachments = new Map<string, { count: number; firstError: string }>();
    let processedRows = 0;
    let restarts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        for await (const page of client.listRecords(ro.airtableBaseId, tablePlan.airtableTableId)) {
          // After an iterator restart, skip already imported records.
          const records = page.filter((record) => !recordIdMap.has(record.id));
          if (records.length === 0) continue;

          const payloads = await this.buildRecordPayloads({
            tablePlan,
            records,
            usersByEmail,
            importAttachments,
            droppedCollaborators,
            failedAttachments,
          });
          // Teable assigns each create batch a descending order, which flips the
          // rows in the view. Send the batch reversed so records keep the source
          // order, then map results back by their original index.
          const created = await this.recordOpenApiV2Service.createRecords(tableId, {
            fieldKeyType: FieldKeyType.Id,
            typecast: true,
            records: payloads.slice().reverse(),
          });
          const createdInOrder = created.records.slice().reverse();
          records.forEach((record, recordIndex) => {
            const createdRecord = createdInOrder[recordIndex];
            if (createdRecord) {
              recordIdMap.set(record.id, createdRecord.id);
            }
          });
          await this.collectLinkRows({
            tablePlan,
            records,
            createdIds: createdInOrder.map((record) => record?.id),
            linkSpill,
            linkFieldsWithMulti,
          });

          processedRows += records.length;
          progress({
            phase: 'table_records_progress',
            tableName: tablePlan.name,
            tableIndex,
            totalTables,
            processedRows,
          });
        }
        break;
      } catch (error) {
        if (error instanceof AirtableIteratorExpiredError && restarts < maxListRestarts) {
          restarts++;
          this.logger.warn(
            `Airtable list-records iterator expired for table ${tablePlan.airtableTableId}, restarting (${restarts}/${maxListRestarts})`
          );
          continue;
        }
        throw error;
      }
    }

    for (const [fieldName, count] of droppedCollaborators) {
      issues.push({
        code: 'valuesDropped',
        tableName: tablePlan.name,
        fieldName,
        count,
        reason: 'collaborator is not a member of the space',
      });
    }
    for (const [fieldName, { count, firstError }] of failedAttachments) {
      issues.push({
        code: 'valuesDropped',
        tableName: tablePlan.name,
        fieldName,
        count,
        reason: `attachment download failed: ${firstError}`,
      });
    }

    progress({
      phase: 'table_records_done',
      tableName: tablePlan.name,
      tableIndex,
      totalTables,
      processedRows,
    });
  }

  private async buildRecordPayloads(params: {
    tablePlan: IAirtableTablePlan;
    records: IAirtableRecord[];
    usersByEmail: Map<string, IResolvedSpaceUser>;
    importAttachments: boolean;
    droppedCollaborators: Map<string, number>;
    failedAttachments: Map<string, { count: number; firstError: string }>;
  }): Promise<Array<{ fields: Record<string, unknown> }>> {
    const {
      tablePlan,
      records,
      usersByEmail,
      importAttachments,
      droppedCollaborators,
      failedAttachments,
    } = params;

    // eslint-disable-next-line sonarjs/cognitive-complexity
    const payloads = records.map((record) => {
      const fields: Record<string, unknown> = {};
      for (const planned of tablePlan.fields) {
        const raw = record.fields[planned.airtableFieldId];
        if (raw == null) continue;
        const fieldId = planned.ro.id as string;
        if (planned.converter === 'user') {
          const isMultiple = (planned.ro.options as IUserFieldOptions)?.isMultiple === true;
          const { value, droppedCount } = convertCollaboratorCellValue(
            raw,
            usersByEmail,
            isMultiple
          );
          if (droppedCount > 0) {
            const name = planned.ro.name as string;
            droppedCollaborators.set(name, (droppedCollaborators.get(name) ?? 0) + droppedCount);
          }
          if (value !== undefined) fields[fieldId] = value;
          continue;
        }
        if (planned.converter === 'attachment') {
          continue; // handled below, needs async upload
        }
        const value = convertAirtableCellValue(planned.converter, raw);
        if (value !== undefined) fields[fieldId] = value;
      }
      return { fields };
    });

    if (importAttachments) {
      const attachmentFields = tablePlan.fields.filter(
        (planned) => planned.converter === 'attachment'
      );
      const cells: Array<{
        payloadIndex: number;
        fieldId: string;
        fieldName: string;
        attachments: IAirtableAttachment[];
      }> = [];
      records.forEach((record, payloadIndex) => {
        for (const planned of attachmentFields) {
          const raw = record.fields[planned.airtableFieldId];
          if (!Array.isArray(raw) || raw.length === 0) continue;
          cells.push({
            payloadIndex,
            fieldId: planned.ro.id as string,
            fieldName: planned.ro.name as string,
            attachments: raw as IAirtableAttachment[],
          });
        }
      });

      await mapWithConcurrency(cells, attachmentConcurrency, async (cell) => {
        const items = [];
        for (const attachment of cell.attachments) {
          if (typeof attachment?.url !== 'string') continue;
          try {
            items.push(await this.transferAttachment(attachment));
          } catch (error) {
            const message = error instanceof Error ? error.message : unknownErrorText;
            this.logger.warn(
              `Failed to migrate Airtable attachment "${attachment.filename}": ${message}`
            );
            const failure = failedAttachments.get(cell.fieldName);
            failedAttachments.set(cell.fieldName, {
              count: (failure?.count ?? 0) + 1,
              firstError: failure?.firstError ?? message.slice(0, 200),
            });
          }
        }
        if (items.length > 0) {
          payloads[cell.payloadIndex].fields[cell.fieldId] = items;
        }
      });
    }

    return payloads;
  }

  /**
   * Streams an attachment straight from the Airtable CDN into the storage
   * backend - no temp file. Airtable provides the size up front, which the
   * presigned upload requires.
   */
  private async transferAttachment(attachment: IAirtableAttachment) {
    // Airtable gives the size up front, so reject an over-limit attachment
    // before opening the CDN socket at all.
    const maxSize = this.attachmentsService.thresholdConfig.maxOpenapiAttachmentUploadSize;
    if (attachment.size && attachment.size > maxSize) {
      throw new Error(
        `attachment "${attachment.filename}" (${attachment.size} bytes) exceeds the ${maxSize}-byte upload limit`
      );
    }
    const response = await fetch(attachment.url);
    if (!response.ok || !response.body) {
      throw new Error(`download failed with status ${response.status}`);
    }
    const contentLength = attachment.size ?? Number(response.headers.get('content-length'));
    if (!contentLength || !Number.isFinite(contentLength)) {
      await response.body.cancel();
      throw new Error('attachment size is unknown');
    }
    const contentType =
      attachment.type ?? response.headers.get('content-type') ?? 'application/octet-stream';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = Readable.fromWeb(response.body as any);
    try {
      return await this.attachmentsService.uploadFromStream(
        stream,
        { filename: attachment.filename, contentType, contentLength },
        UploadType.Table
      );
    } catch (error) {
      // Release the still-open CDN socket on any upload failure (e.g. the
      // size-limit check) instead of leaking it.
      stream.destroy();
      throw error;
    }
  }

  private async collectLinkRows(params: {
    tablePlan: IAirtableTablePlan;
    records: IAirtableRecord[];
    createdIds: Array<string | undefined>;
    linkSpill: AirtableLinkRowSpill;
    linkFieldsWithMulti: Set<string>;
  }) {
    const { tablePlan, records, createdIds, linkSpill, linkFieldsWithMulti } = params;
    if (tablePlan.linkFields.length === 0) return;

    const rows: ISpilledLinkRow[] = [];
    records.forEach((record, index) => {
      const teableRecordId = createdIds[index];
      if (!teableRecordId) return;
      const cells: ISpilledLinkRow['cells'] = [];
      for (const linkField of tablePlan.linkFields) {
        const ids = extractLinkedRecordIds(record.fields[linkField.airtableFieldId]);
        if (ids.length === 0) continue;
        // Airtable's single-link is a soft per-cell limit, so a "single" field's
        // data can still hold several links; remember those so the field is
        // relaxed to many-to-many instead of truncating them.
        if (ids.length > 1) linkFieldsWithMulti.add(linkField.airtableFieldId);
        cells.push({ airtableFieldId: linkField.airtableFieldId, ids });
      }
      if (cells.length > 0) {
        rows.push({ teableRecordId, cells });
      }
    });
    await linkSpill.append(tablePlan.airtableTableId, rows);
  }

  /**
   * Follows the relationship Airtable declares. One-to-* variants are not
   * used because foreign-side uniqueness cannot be guaranteed before the
   * records arrive; cells that violate a single link are truncated at fill
   * time and reported.
   */
  private decideRelationship(linkField: IPlannedLinkField): Relationship {
    return linkField.prefersSingle ? Relationship.ManyOne : Relationship.ManyMany;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async createLinkFields(params: {
    plan: IAirtableImportPlan;
    tableIdMap: Record<string, string>;
    viewIdMap: Record<string, string>;
    issues: IImportAirtableIssue[];
  }): Promise<Map<string, ILinkFieldRuntime>> {
    const { plan, tableIdMap, viewIdMap, issues } = params;
    const runtimes = new Map<string, ILinkFieldRuntime>();

    for (const tablePlan of plan.tables) {
      const tableId = tableIdMap[tablePlan.airtableTableId];
      for (const linkField of tablePlan.linkFields) {
        const relationship = this.decideRelationship(linkField);
        // Airtable's "limit record selection to a view" -> Teable filterByViewId.
        // The referenced view lives in the foreign table; skip (and report) when it
        // did not import so an invalid view id is never set.
        let filterByViewId: string | undefined;
        if (linkField.viewIdForRecordSelection) {
          filterByViewId = viewIdMap[linkField.viewIdForRecordSelection];
          if (!filterByViewId) {
            issues.push({
              code: 'viewConfigDegraded',
              tableName: tablePlan.name,
              fieldName: linkField.name,
              reason: 'record-selection view was not imported',
            });
          }
        }
        const fieldRo = {
          id: linkField.teableFieldId,
          name: linkField.name,
          description: linkField.description,
          type: FieldType.Link,
          options: {
            relationship,
            foreignTableId: tableIdMap[linkField.airtableForeignTableId],
            isOneWay: linkField.inverse == null,
            ...(filterByViewId ? { filterByViewId } : {}),
          },
        } as IFieldRo;
        try {
          const created = await this.fieldOpenApiV2Service.createField(tableId, fieldRo);
          plan.fieldIdMap[linkField.airtableFieldId] = created.id;
          runtimes.set(linkField.airtableFieldId, {
            plan: linkField,
            tableAirtableId: tablePlan.airtableTableId,
            relationship,
          });

          const symmetricFieldId = (created.options as ILinkFieldOptions)?.symmetricFieldId;
          if (linkField.inverse && symmetricFieldId) {
            plan.fieldIdMap[linkField.inverse.airtableFieldId] = symmetricFieldId;
            try {
              await this.renameSymmetricLinkField(
                tableIdMap[linkField.airtableForeignTableId],
                symmetricFieldId,
                linkField.inverse.name
              );
            } catch (error) {
              this.logger.warn(
                `Failed to rename symmetric link field to "${linkField.inverse.name}": ${
                  error instanceof Error ? error.message : unknownErrorText
                }`
              );
            }
          }
        } catch (error) {
          this.logger.warn(
            `Failed to create link field "${linkField.name}": ${
              error instanceof Error ? error.message : unknownErrorText
            }`
          );
          issues.push({
            code: 'fieldSkipped',
            tableName: tablePlan.name,
            fieldName: linkField.name,
            fromType: 'multipleRecordLinks',
            reason: 'failed to create link field',
          });
        }
      }
    }
    return runtimes;
  }

  /**
   * Renames the symmetric link field Teable auto-creates for a two-way link to
   * the Airtable inverse field's name. A plain field update drops the owning
   * link field; convert keeps the link by re-specifying its full options.
   */
  private async renameSymmetricLinkField(tableId: string, fieldId: string, name: string) {
    const symmetric = await this.fieldOpenApiV2Service.getField(tableId, fieldId);
    await this.fieldOpenApiV2Service.convertField(tableId, fieldId, {
      name,
      type: symmetric.type,
      options: symmetric.options,
    } as Parameters<FieldOpenApiV2Service['convertField']>[2]);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async createLookupFields(
    plan: IAirtableImportPlan,
    tableIdMap: Record<string, string>,
    issues: IImportAirtableIssue[]
  ) {
    for (const tablePlan of plan.tables) {
      const tableId = tableIdMap[tablePlan.airtableTableId];
      for (const lookupField of tablePlan.lookupFields) {
        const foreignPlan = plan.tables.find(
          (candidate) => candidate.airtableTableId === lookupField.airtableForeignTableId
        );
        const targetField = foreignPlan?.fields.find(
          (candidate) => candidate.airtableFieldId === lookupField.airtableTargetFieldId
        );
        const linkFieldId = plan.fieldIdMap[lookupField.airtableLinkFieldId];
        const lookupFieldId = plan.fieldIdMap[lookupField.airtableTargetFieldId];
        if (!targetField || !linkFieldId || !lookupFieldId) {
          issues.push({
            code: 'fieldSkipped',
            tableName: tablePlan.name,
            fieldName: lookupField.name,
            fromType: 'multipleLookupValues',
            reason: 'link or target field was not imported',
          });
          continue;
        }
        const fieldRo = {
          id: lookupField.teableFieldId,
          name: lookupField.name,
          description: lookupField.description,
          type: targetField.ro.type,
          isLookup: true,
          lookupOptions: {
            foreignTableId: tableIdMap[lookupField.airtableForeignTableId],
            linkFieldId,
            lookupFieldId,
          },
        } as IFieldRo;
        try {
          await this.fieldOpenApiV2Service.createField(tableId, fieldRo);
        } catch (error) {
          this.logger.warn(
            `Failed to create lookup field "${lookupField.name}": ${
              error instanceof Error ? error.message : unknownErrorText
            }`
          );
          issues.push({
            code: 'fieldSkipped',
            tableName: tablePlan.name,
            fieldName: lookupField.name,
            fromType: 'multipleLookupValues',
            reason: `failed to create lookup field: ${
              error instanceof Error ? error.message : unknownErrorText
            }`,
          });
        }
      }
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async createCountFields(
    plan: IAirtableImportPlan,
    tableIdMap: Record<string, string>,
    issues: IImportAirtableIssue[]
  ) {
    for (const tablePlan of plan.tables) {
      const tableId = tableIdMap[tablePlan.airtableTableId];
      for (const countField of tablePlan.countFields) {
        const foreignPlan = plan.tables.find(
          (candidate) => candidate.airtableTableId === countField.airtableForeignTableId
        );
        const linkFieldId = plan.fieldIdMap[countField.airtableLinkFieldId];
        const foreignPrimary = foreignPlan?.fields[0];
        if (!linkFieldId || !foreignPrimary) {
          issues.push({
            code: 'fieldSkipped',
            tableName: tablePlan.name,
            fieldName: countField.name,
            fromType: 'count',
            reason: 'link field was not imported',
          });
          continue;
        }
        const fieldRo = {
          id: countField.teableFieldId,
          name: countField.name,
          description: countField.description,
          type: FieldType.Rollup,
          options: { expression: 'countall({values})' },
          lookupOptions: {
            foreignTableId: tableIdMap[countField.airtableForeignTableId],
            linkFieldId,
            lookupFieldId: foreignPrimary.ro.id as string,
          },
        } as IFieldRo;
        try {
          await this.fieldOpenApiV2Service.createField(tableId, fieldRo);
        } catch (error) {
          this.logger.warn(
            `Failed to create count field "${countField.name}": ${
              error instanceof Error ? error.message : unknownErrorText
            }`
          );
          issues.push({
            code: 'fieldSkipped',
            tableName: tablePlan.name,
            fieldName: countField.name,
            fromType: 'count',
            reason: `failed to create rollup field: ${
              error instanceof Error ? error.message : unknownErrorText
            }`,
          });
        }
      }
    }
  }

  /**
   * Recreates rollups as live Teable rollups using the aggregation and optional
   * record-selection filter read from the shared base model. The filter is mapped
   * best-effort — conditions that cannot be translated are dropped (and reported)
   * so the rollup stays live rather than degrading to a snapshot.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- per-rollup filter mapping
  private async createRollupFields(
    plan: IAirtableImportPlan,
    tableIdMap: Record<string, string>,
    airtableTables: IAirtableTable[],
    issues: IImportAirtableIssue[]
  ) {
    const rollups = plan.tables.flatMap((tablePlan) =>
      tablePlan.rollupFields.map((rollupField) => ({ tablePlan, rollupField }))
    );
    if (rollups.length === 0) return;
    const optionNames = this.buildSelectOptionNames(airtableTables);

    for (const { tablePlan, rollupField } of rollups) {
      const linkFieldId = plan.fieldIdMap[rollupField.airtableLinkFieldId];
      const lookupFieldId = plan.fieldIdMap[rollupField.airtableForeignFieldId];
      const foreignTableId = tableIdMap[rollupField.airtableForeignTableId];
      if (!linkFieldId || !lookupFieldId || !foreignTableId) {
        issues.push({
          code: 'fieldSkipped',
          tableName: tablePlan.name,
          fieldName: rollupField.name,
          fromType: 'rollup',
          reason: 'link or rolled-up field was not imported',
        });
        continue;
      }

      let filter: IFilter | undefined;
      if (rollupField.filter) {
        const metaMap = await this.fetchFieldMeta(foreignTableId);
        let dropped = 0;
        const ctx: IViewConfigMapperContext = {
          resolveField: (columnId) => {
            const teableFieldId = plan.fieldIdMap[columnId];
            return teableFieldId ? metaMap.get(teableFieldId) : undefined;
          },
          resolveSelectOptionName: (columnId, optionId) => optionNames.get(columnId)?.get(optionId),
        };
        filter = mapAirtableFilter(rollupField.filter, ctx, () => {
          dropped += 1;
        });
        if (dropped > 0) {
          issues.push({
            code: 'fieldDegraded',
            tableName: tablePlan.name,
            fieldName: rollupField.name,
            fromType: 'rollup',
            toType: `live rollup (${dropped} filter condition(s) dropped)`,
          });
        }
      }

      const fieldRo = {
        id: rollupField.teableFieldId,
        name: rollupField.name,
        description: rollupField.description,
        type: FieldType.Rollup,
        options: { expression: rollupField.expression },
        lookupOptions: {
          foreignTableId,
          linkFieldId,
          lookupFieldId,
          ...(filter ? { filter } : {}),
        },
      } as IFieldRo;
      try {
        await this.fieldOpenApiV2Service.createField(
          tableIdMap[tablePlan.airtableTableId],
          fieldRo
        );
      } catch (error) {
        this.logger.warn(
          `Failed to create rollup field "${rollupField.name}": ${
            error instanceof Error ? error.message : unknownErrorText
          }`
        );
        issues.push({
          code: 'fieldSkipped',
          tableName: tablePlan.name,
          fieldName: rollupField.name,
          fromType: 'rollup',
          reason: `failed to create rollup field: ${
            error instanceof Error ? error.message : unknownErrorText
          }`,
        });
      }
    }
  }

  /**
   * Creates the translated formula fields last, after every other field exists.
   * A formula may reference another formula, so fields are created in dependency
   * passes: each pass retries the ones that failed (typically because a
   * referenced formula did not exist yet) until a pass makes no progress.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- dependency-pass retry loop
  private async createFormulaFields(
    plan: IAirtableImportPlan,
    tableIdMap: Record<string, string>,
    issues: IImportAirtableIssue[]
  ) {
    const remapReferences = (expression: string) =>
      expression.replace(/\{(fld[a-zA-Z0-9]+)\}/g, (token, airtableFieldId) => {
        const teableFieldId = plan.fieldIdMap[airtableFieldId];
        return teableFieldId ? `{${teableFieldId}}` : token;
      });

    let pending = plan.tables.flatMap((tablePlan) =>
      tablePlan.formulaFields.map((formulaField) => ({ tablePlan, formulaField }))
    );
    while (pending.length > 0) {
      const failed: {
        tablePlan: IAirtableTablePlan;
        formulaField: IPlannedFormulaField;
        error: unknown;
      }[] = [];
      for (const { tablePlan, formulaField } of pending) {
        const fieldRo = {
          id: formulaField.teableFieldId,
          name: formulaField.name,
          description: formulaField.description,
          type: FieldType.Formula,
          options: { expression: remapReferences(formulaField.expression) },
        } as IFieldRo;
        try {
          await this.fieldOpenApiV2Service.createField(
            tableIdMap[tablePlan.airtableTableId],
            fieldRo
          );
        } catch (error) {
          failed.push({ tablePlan, formulaField, error });
        }
      }
      if (failed.length === pending.length) {
        // No progress this pass: the remaining failures are real, report them.
        for (const { tablePlan, formulaField, error } of failed) {
          this.logger.warn(
            `Failed to create formula field "${formulaField.name}": ${
              error instanceof Error ? error.message : unknownErrorText
            }`
          );
          issues.push({
            code: 'fieldSkipped',
            tableName: tablePlan.name,
            fieldName: formulaField.name,
            fromType: 'formula',
            reason: `failed to create formula field: ${
              error instanceof Error ? error.message : unknownErrorText
            }`,
          });
        }
        break;
      }
      pending = failed.map(({ tablePlan, formulaField }) => ({ tablePlan, formulaField }));
    }
  }

  /**
   * Airtable's "single record link" is a soft per-cell limit, not enforced
   * uniqueness — a single-link field's data can still hold several links (e.g.
   * the side of a 1:1 that several records point at). Teable's ManyOne would
   * truncate those, so relax any single link whose data actually held multiple
   * values to a many-to-many link (lossless) and report it, instead of dropping
   * links. Runs before fill, while the field is still empty, so the conversion
   * is trivially safe; a failed conversion falls back to truncate-and-report.
   */
  private async relaxOversizedSingleLinks(params: {
    plan: IAirtableImportPlan;
    linkRuntimes: Map<string, ILinkFieldRuntime>;
    linkFieldsWithMulti: Set<string>;
    tableIdMap: Record<string, string>;
    issues: IImportAirtableIssue[];
  }): Promise<void> {
    const { plan, linkRuntimes, linkFieldsWithMulti, tableIdMap, issues } = params;
    const tableNameByAirtableId = new Map(plan.tables.map((t) => [t.airtableTableId, t.name]));
    for (const runtime of linkRuntimes.values()) {
      if (runtime.relationship !== Relationship.ManyOne) continue;
      if (!linkFieldsWithMulti.has(runtime.plan.airtableFieldId)) continue;
      const tableId = tableIdMap[runtime.tableAirtableId];
      try {
        await this.fieldOpenApiV2Service.convertField(tableId, runtime.plan.teableFieldId, {
          name: runtime.plan.name,
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: tableIdMap[runtime.plan.airtableForeignTableId],
            isOneWay: runtime.plan.inverse == null,
          },
        } as Parameters<FieldOpenApiV2Service['convertField']>[2]);
        runtime.relationship = Relationship.ManyMany;
        issues.push({
          code: 'fieldDegraded',
          tableName: tableNameByAirtableId.get(runtime.tableAirtableId) ?? '',
          fieldName: runtime.plan.name,
          fromType: 'multipleRecordLinks',
          toType: 'many-to-many link',
          reason: 'single-link data contained multiple links; kept them all',
        });
      } catch (error) {
        // Keep ManyOne — fillLinkValues truncates the over-capacity cells and
        // reports them, so the import still succeeds.
        this.logger.warn(
          `[airtable-import] could not relax single link "${runtime.plan.name}": ${
            error instanceof Error ? error.message : 'error'
          }`
        );
      }
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async fillLinkValues(params: {
    plan: IAirtableImportPlan;
    tableIdMap: Record<string, string>;
    linkRuntimes: Map<string, ILinkFieldRuntime>;
    recordIdMaps: Map<string, Map<string, string>>;
    linkSpill: AirtableLinkRowSpill;
    issues: IImportAirtableIssue[];
    progress: (event: IAirtableImportProgress) => void;
  }) {
    const { plan, tableIdMap, linkRuntimes, recordIdMaps, linkSpill, issues, progress } = params;

    for (const tablePlan of plan.tables) {
      if (tablePlan.linkFields.length === 0) continue;
      const tableId = tableIdMap[tablePlan.airtableTableId];
      // Only write link fields that actually exist; one that failed to
      // materialize is skipped and reported, never fatal to the import.
      const existingFieldIds = new Set((await this.fetchFieldMeta(tableId)).keys());
      const droppedByField = new Map<string, number>();
      const truncatedByField = new Map<string, number>();
      const missingByField = new Set<string>();
      let processedRows = 0;
      let batch: Array<{ id: string; fields: Record<string, unknown> }> = [];

      const flush = async () => {
        if (batch.length === 0) return;
        await this.recordOpenApiV2Service.updateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          typecast: false,
          records: batch,
        });
        batch = [];
        progress({ phase: 'filling_links', tableName: tablePlan.name, processedRows });
      };

      // Rows stream back from the disk spill, so memory stays flat no matter
      // how many link cells the base contains.
      for await (const row of linkSpill.read(tablePlan.airtableTableId)) {
        processedRows++;
        const fields: Record<string, unknown> = {};
        for (const cell of row.cells) {
          const runtime = linkRuntimes.get(cell.airtableFieldId);
          const teableFieldId = plan.fieldIdMap[cell.airtableFieldId];
          if (!runtime || !teableFieldId) continue;
          if (!existingFieldIds.has(teableFieldId)) {
            missingByField.add(runtime.plan.name);
            continue;
          }
          const foreignMap = recordIdMaps.get(runtime.plan.airtableForeignTableId);
          const mappedIds = cell.ids
            .map((id) => foreignMap?.get(id))
            .filter((id): id is string => id != null);
          const droppedCount = cell.ids.length - mappedIds.length;
          if (droppedCount > 0) {
            droppedByField.set(
              runtime.plan.name,
              (droppedByField.get(runtime.plan.name) ?? 0) + droppedCount
            );
          }
          if (mappedIds.length === 0) continue;
          const isSingle = runtime.relationship === Relationship.ManyOne;
          if (isSingle && mappedIds.length > 1) {
            // The Airtable field declared single links but the data disagrees.
            truncatedByField.set(
              runtime.plan.name,
              (truncatedByField.get(runtime.plan.name) ?? 0) + mappedIds.length - 1
            );
          }
          fields[teableFieldId] = isSingle ? { id: mappedIds[0] } : mappedIds.map((id) => ({ id }));
        }
        if (Object.keys(fields).length > 0) {
          batch.push({ id: row.teableRecordId, fields });
          if (batch.length >= linkUpdateBatchSize) {
            await flush();
          }
        }
      }
      await flush();

      for (const [fieldName, count] of droppedByField) {
        issues.push({
          code: 'valuesDropped',
          tableName: tablePlan.name,
          fieldName,
          count,
          reason: 'linked record not found',
        });
      }
      for (const [fieldName, count] of truncatedByField) {
        issues.push({
          code: 'valuesDropped',
          tableName: tablePlan.name,
          fieldName,
          count,
          reason: 'kept only the first record of a single-link field',
        });
      }
      for (const fieldName of missingByField) {
        issues.push({
          code: 'fieldSkipped',
          tableName: tablePlan.name,
          fieldName,
          fromType: 'multipleRecordLinks',
          reason: 'link field was not created; its values were skipped',
        });
      }
    }
  }
}
