/* eslint-disable @typescript-eslint/naming-convention */
import { PassThrough, Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { ILocalization } from '@teable/core';
import { getRandomString } from '@teable/core';
import { UploadType } from '@teable/openapi';
import type { ExportBaseProgressCallback, IExportBaseVo } from '@teable/openapi';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  FieldKeyType,
  ListTableRecordsQuery,
  normalizeDotTeaExportFieldsForSelfContainedBase,
  v2CoreTokens,
  type IExecutionContext,
  type IQueryBus,
  type ListTableRecordsResult,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import archiver from 'archiver';
import { stringify } from 'csv-stringify/sync';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ClsService } from 'nestjs-cls';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import type { I18nPath } from '../../types/i18n.generated';
import { resolveBuildVersion } from '../../utils/build-version';
import { second } from '../../utils/second';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { NotificationService } from '../notification/notification.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';
import { EXCLUDE_SYSTEM_FIELDS } from './constant';

type ExportDb = Kysely<unknown>;

type BaseRow = {
  id: string;
  name: string;
  icon: string | null;
  v2_enabled: boolean | null;
};

type TableRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  db_table_name: string;
  order: number;
};

type FieldRow = {
  id: string;
  name: string;
  description: string | null;
  options: string | null;
  meta: string | null;
  ai_config: string | null;
  type: string;
  cell_value_type: string;
  is_multiple_cell_value: boolean | null;
  db_field_type: string;
  db_field_name: string;
  not_null: boolean | null;
  unique: boolean | null;
  is_primary: boolean | null;
  is_lookup: boolean | null;
  is_conditional_lookup: boolean | null;
  has_error: boolean | null;
  lookup_options: string | null;
  table_id: string;
  order: number;
  created_time: Date | string;
};

type ViewRow = {
  id: string;
  name: string;
  description: string | null;
  table_id: string;
  type: string;
  sort: string | null;
  filter: string | null;
  group: string | null;
  options: string | null;
  column_meta: string | null;
  enable_share: boolean | null;
  share_meta: string | null;
  share_id: string | null;
  is_locked: boolean | null;
  order: number;
};

type AttachmentFileRow = {
  token: string;
  name: string | null;
  path: string;
  thumbnail_path: string | null;
};

type AttachmentMetadataRow = {
  id: string;
  token: string;
  hash: string;
  size: number | bigint;
  mimetype: string;
  path: string;
  width: number | null;
  height: number | null;
  deleted_time: Date | string | null;
  created_time: Date | string;
  created_by: string;
  last_modified_by: string | null;
  thumbnail_path: string | null;
};

const csvChunkSize = 500;
const fileSuffix = 'tea';

const parseJson = (value: string | null | undefined): unknown | undefined => {
  if (!value) return undefined;
  return JSON.parse(value);
};

const parseJsonOrNull = (value: string | null | undefined): unknown | null => {
  if (!value) return null;
  return JSON.parse(value);
};

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const splitDbTableName = (dbTableName: string): [string, string] => {
  const parts = dbTableName.split('.');
  if (parts.length === 1) return ['public', parts[0]!];
  return [parts[0]!, parts.slice(1).join('.')];
};

const identifier = (name: string) => sql.id(...name.split('.'));

const serializeCsvValue = (value: unknown): unknown => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
};

@Injectable()
export class BaseExportV2Service {
  private readonly logger = new Logger(BaseExportV2Service.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>,
    private readonly notificationService: NotificationService,
    private readonly eventEmitterService: EventEmitterService,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @StorageConfig() private readonly storageConfig: IStorageConfig
  ) {}

  async exportBaseZip(
    baseId: string,
    includeData = true,
    onProgress?: ExportBaseProgressCallback
  ): Promise<IExportBaseVo | undefined> {
    onProgress?.('preparing');
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const metaDb = container.resolve<ExportDb>(v2MetaDbTokens.db);
    const dataDb = container.resolve<ExportDb>(v2DataDbTokens.db);
    const base = await this.getBase(metaDb, baseId);
    const baseName = base.name;
    const passThrough = new PassThrough();
    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') {
        passThrough.emit('error', err);
      }
    });
    archive.on('error', (err) => {
      passThrough.emit('error', err);
    });
    archive.pipe(passThrough);

    const token = getRandomString(12);
    const bucket = StorageAdapter.getBucket(UploadType.ExportBase);
    const pathDir = StorageAdapter.getDir(UploadType.ExportBase);
    const exportFileName = `${baseName}.${fileSuffix}`;
    const uploadPromise = this.storageAdapter.uploadFileStream(
      bucket,
      `${pathDir}/${token}.${fileSuffix}`,
      passThrough,
      {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(exportFileName)}`,
      }
    );

    try {
      onProgress?.('exporting_archive');
      await this.processExportBaseZip(
        metaDb,
        dataDb,
        container,
        base,
        includeData,
        archive,
        onProgress
      );
      await archive.finalize();
      onProgress?.('uploading_archive');
      const uploadResult = await uploadPromise;
      onProgress?.('generating_download_url');
      const previewUrl = await this.storageAdapter.getPreviewUrl(
        bucket,
        uploadResult.path,
        second(this.storageConfig.tokenExpireIn),
        {
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(exportFileName)}`,
        }
      );

      await this.notifyExportResult(
        baseId,
        {
          i18nKey: 'common.email.templates.notify.exportBase.success.message',
          context: {
            baseName,
            previewUrl,
            name: exportFileName,
          },
        },
        {
          status: 'success',
          previewUrl,
          attachment: {
            name: exportFileName,
            path: uploadResult.path,
          },
        }
      );
      onProgress?.('done');
      return { previewUrl, baseName, fileName: exportFileName };
    } catch (error) {
      this.captureExportError(error, { baseId, baseName, includeData });
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      await this.notifyExportResult(
        baseId,
        {
          i18nKey: 'common.email.templates.notify.exportBase.failed.message',
          context: {
            baseName,
            errorMessage: message,
          },
        },
        {
          status: 'failed',
          errorMessage: message,
        }
      );
      if (onProgress) {
        throw error;
      }
    }
  }

  private getQueryBus(container: DependencyContainer): IQueryBus {
    return container.resolve<IQueryBus>(v2CoreTokens.queryBus);
  }

  private async processExportBaseZip(
    metaDb: ExportDb,
    dataDb: ExportDb,
    container: DependencyContainer,
    base: BaseRow,
    includeData: boolean,
    archive: archiver.Archiver,
    onProgress?: ExportBaseProgressCallback
  ) {
    const [tables, fields, views] = await Promise.all([
      this.getTables(metaDb, base.id),
      this.getFields(metaDb, base.id),
      this.getViews(metaDb, base.id),
    ]);
    onProgress?.('exporting_structure');
    const structure = await this.extendBaseStructConfig(
      await this.generateBaseStructConfig(metaDb, base, tables, fields, views),
      base.id
    );
    archive.append(Readable.from(JSON.stringify(structure, null, 2)), { name: 'structure.json' });

    if (includeData) {
      onProgress?.('exporting_attachments');
      await this.appendAttachments(metaDb, 'attachments', tables, archive);
      onProgress?.('exporting_attachment_metadata');
      await this.appendAttachmentsDataCsv(metaDb, 'attachments', tables, archive);
      onProgress?.('exporting_table_data');
      await this.appendTableDataCsvs(
        dataDb,
        container,
        'tables',
        tables,
        fields,
        archive,
        onProgress
      );
    }

    onProgress?.('exporting_extra_files');
    await this.appendExtraArchiveFiles(base.id, archive);
  }

  protected async extendBaseStructConfig(structure: unknown, baseId: string): Promise<unknown> {
    void baseId;
    return structure;
  }

  protected async appendExtraArchiveFiles(baseId: string, archive: archiver.Archiver) {
    void baseId;
    void archive;
  }

  private async getBase(db: ExportDb, baseId: string): Promise<BaseRow> {
    const result = await sql<BaseRow>`
      select "id", "name", "icon", "v2_enabled"
      from "base"
      where "id" = ${baseId}
        and "deleted_time" is null
      limit 1
    `.execute(db);
    const base = result.rows[0];
    if (!base) {
      throw new Error('Base not found');
    }
    return base;
  }

  private async getTables(db: ExportDb, baseId: string): Promise<TableRow[]> {
    const result = await sql<TableRow>`
      select "id", "name", "description", "icon", "db_table_name", "order"
      from "table_meta"
      where "base_id" = ${baseId}
        and "deleted_time" is null
      order by "order" asc
    `.execute(db);
    return [...result.rows];
  }

  private async getFields(db: ExportDb, baseId: string): Promise<FieldRow[]> {
    const result = await sql<FieldRow>`
      select f.*
      from "field" f
      inner join "table_meta" t on t."id" = f."table_id"
      where t."base_id" = ${baseId}
        and t."deleted_time" is null
        and f."deleted_time" is null
      order by f."order" asc
    `.execute(db);
    return [...result.rows];
  }

  private async getViews(db: ExportDb, baseId: string): Promise<ViewRow[]> {
    const result = await sql<ViewRow>`
      select v.*
      from "view" v
      inner join "table_meta" t on t."id" = v."table_id"
      where t."base_id" = ${baseId}
        and t."deleted_time" is null
        and v."deleted_time" is null
      order by v."order" asc
    `.execute(db);
    return [...result.rows];
  }

  private async generateBaseStructConfig(
    db: ExportDb,
    base: BaseRow,
    tables: TableRow[],
    fields: FieldRow[],
    views: ViewRow[]
  ) {
    return {
      id: base.id,
      name: base.name,
      icon: base.icon,
      version: resolveBuildVersion(),
      tables: tables.map((table) => ({
        id: table.id,
        name: table.name,
        order: table.order,
        description: table.description ?? undefined,
        icon: table.icon ?? undefined,
        dbTableName: table.db_table_name.split('.').pop(),
        fields: this.generateFieldConfig(fields.filter((field) => field.table_id === table.id)),
        views: this.generateViewConfig(views.filter((view) => view.table_id === table.id)),
      })),
      folders: await this.generateFolderConfig(db, base.id),
      nodes: await this.generateNodeConfig(db, base.id),
      plugins: await this.generatePluginConfig(db, base.id, tables),
    };
  }

  private generateFieldConfig(fields: FieldRow[]) {
    return normalizeDotTeaExportFieldsForSelfContainedBase(
      fields.map((field) => ({
        id: field.id,
        name: field.name,
        description: field.description ?? undefined,
        type: field.type,
        options: parseJson(field.options),
        dbFieldName: field.db_field_name,
        notNull: field.not_null ?? undefined,
        unique: field.unique ?? undefined,
        isPrimary: field.is_primary ?? undefined,
        hasError: field.has_error ?? undefined,
        order: field.order,
        lookupOptions: parseJson(field.lookup_options),
        isLookup: field.is_lookup ?? undefined,
        isConditionalLookup: field.is_conditional_lookup ?? undefined,
        aiConfig: parseJson(field.ai_config),
        meta: parseJson(field.meta),
        dbFieldType: field.db_field_type,
        cellValueType: field.cell_value_type,
        isMultipleCellValue: field.is_multiple_cell_value ?? undefined,
        createdTime: toIsoString(field.created_time),
      }))
    );
  }

  private generateViewConfig(views: ViewRow[]) {
    return views.map((view, index) => ({
      id: view.id,
      name: view.name,
      description: view.description ?? undefined,
      type: view.type,
      sort: parseJson(view.sort),
      filter: parseJson(view.filter),
      group: parseJson(view.group),
      options: parseJson(view.options),
      columnMeta: parseJsonOrNull(view.column_meta),
      enableShare: view.enable_share ?? undefined,
      shareMeta: parseJson(view.share_meta),
      shareId: view.share_id ?? undefined,
      isLocked: view.is_locked ?? undefined,
      order: index,
    }));
  }

  private async generateFolderConfig(db: ExportDb, baseId: string) {
    const result = await sql<{ id: string; name: string }>`
      select "id", "name"
      from "base_node_folder"
      where "base_id" = ${baseId}
      order by "created_time" asc
    `.execute(db);
    return result.rows.map((folder) => ({
      id: folder.id,
      name: folder.name,
    }));
  }

  private async generateNodeConfig(db: ExportDb, baseId: string) {
    const result = await sql<{
      id: string;
      parent_id: string | null;
      resource_id: string;
      resource_type: string;
      order: number;
    }>`
      select "id", "parent_id", "resource_id", "resource_type", "order"
      from "base_node"
      where "base_id" = ${baseId}
      order by "created_time" asc
    `.execute(db);
    return result.rows.map((node) => ({
      id: node.id,
      parentId: node.parent_id,
      resourceId: node.resource_id,
      resourceType: node.resource_type,
      order: node.order,
    }));
  }

  private async generatePluginConfig(db: ExportDb, baseId: string, tables: TableRow[]) {
    return {
      dashboard: await this.generateDashboardConfig(db, baseId),
      panel: await this.generatePluginPanelConfig(db, tables),
      view: await this.generatePluginViewConfig(db, tables),
    };
  }

  private async generateDashboardConfig(db: ExportDb, baseId: string) {
    const dashboards = await sql<{ id: string; name: string; layout: string | null }>`
      select "id", "name", "layout"
      from "dashboard"
      where "base_id" = ${baseId}
      order by "created_time" asc
    `.execute(db);
    const installs = await this.getPluginInstalls(
      db,
      dashboards.rows.map((dashboard) => dashboard.id)
    );

    return dashboards.rows.map((dashboard) => ({
      id: dashboard.id,
      name: dashboard.name,
      layout: dashboard.layout ? JSON.parse(dashboard.layout) : null,
      pluginInstall: installs
        .filter((install) => install.position_id === dashboard.id)
        .map(this.mapPluginInstall),
    }));
  }

  private async generatePluginPanelConfig(db: ExportDb, tables: TableRow[]) {
    if (!tables.length) return [];
    const tableIds = tables.map((table) => table.id);
    const panels = await sql<{ id: string; name: string; layout: string | null; table_id: string }>`
      select "id", "name", "layout", "table_id"
      from "plugin_panel"
      where "table_id" in (${sql.join(tableIds)})
      order by "created_time" asc
    `.execute(db);
    const installs = await this.getPluginInstalls(
      db,
      panels.rows.map((panel) => panel.id)
    );

    return panels.rows.map((panel) => ({
      id: panel.id,
      name: panel.name,
      layout: panel.layout ? JSON.parse(panel.layout) : null,
      tableId: panel.table_id,
      pluginInstall: installs
        .filter((install) => install.position_id === panel.id)
        .map(this.mapPluginInstall),
    }));
  }

  private async generatePluginViewConfig(db: ExportDb, tables: TableRow[]) {
    if (!tables.length) return [];
    const tableIds = tables.map((table) => table.id);
    const views = await sql<ViewRow>`
      select v.*
      from "view" v
      where v."table_id" in (${sql.join(tableIds)})
        and v."type" = 'plugin'
        and v."deleted_time" is null
      order by v."created_time" asc
    `.execute(db);
    const installs = await this.getPluginInstalls(
      db,
      views.rows.map((view) => view.id)
    );

    return views.rows.map((view) => ({
      id: view.id,
      name: view.name,
      description: view.description ?? undefined,
      type: view.type,
      isLocked: view.is_locked ?? undefined,
      tableId: view.table_id,
      order: view.order,
      columnMeta: parseJsonOrNull(view.column_meta),
      options: parseJsonOrNull(view.options),
      filter: parseJsonOrNull(view.filter),
      group: parseJsonOrNull(view.group),
      shareMeta: parseJsonOrNull(view.share_meta),
      pluginInstall: this.mapPluginInstall(
        installs.find((install) => install.position_id === view.id)!
      ),
    }));
  }

  private async getPluginInstalls(db: ExportDb, positionIds: string[]) {
    if (!positionIds.length) return [];
    const result = await sql<{
      id: string;
      plugin_id: string;
      position_id: string;
      position: string;
      name: string;
      storage: string | null;
    }>`
      select "id", "plugin_id", "position_id", "position", "name", "storage"
      from "plugin_install"
      where "position_id" in (${sql.join(positionIds)})
    `.execute(db);
    return [...result.rows];
  }

  private mapPluginInstall(install: {
    id: string;
    plugin_id: string;
    position_id: string;
    position: string;
    name: string;
    storage: string | null;
  }) {
    return {
      id: install.id,
      pluginId: install.plugin_id,
      positionId: install.position_id,
      position: install.position,
      name: install.name,
      storage: install.storage ? JSON.parse(install.storage) : null,
    };
  }

  private async appendTableDataCsvs(
    db: ExportDb,
    container: DependencyContainer,
    filePath: string,
    tables: TableRow[],
    fields: FieldRow[],
    archive: archiver.Archiver,
    onProgress?: ExportBaseProgressCallback
  ) {
    const queryBus = this.getQueryBus(container);
    const context = await this.v2ContextFactory.createContext(container);

    for (const [index, table] of tables.entries()) {
      onProgress?.('table_data_started', table.name, {
        type: 'progress',
        phase: 'table_data_started',
        tableId: table.id,
        tableName: table.name,
        tableIndex: index + 1,
        totalTables: tables.length,
      });
      const tableFields = fields.filter((field) => field.table_id === table.id);
      await this.appendTableDataCsv(
        db,
        queryBus,
        context,
        archive,
        filePath,
        table,
        tableFields,
        onProgress
      );
      onProgress?.('table_data_done', table.name, {
        type: 'progress',
        phase: 'table_data_done',
        tableId: table.id,
        tableName: table.name,
        tableIndex: index + 1,
        totalTables: tables.length,
      });
    }
  }

  private async appendTableDataCsv(
    db: ExportDb,
    queryBus: IQueryBus,
    context: IExecutionContext,
    archive: archiver.Archiver,
    filePath: string,
    table: TableRow,
    fields: FieldRow[],
    onProgress?: ExportBaseProgressCallback
  ) {
    const columns = await this.getPhysicalColumnNames(db, table.db_table_name);
    const buttonDbFieldNames = new Set(
      fields.filter((field) => field.type === 'button').map((field) => field.db_field_name)
    );
    const fieldDbNames = fields
      .map((field) => field.db_field_name)
      .filter((name) => !buttonDbFieldNames.has(name));
    const headers = [
      ...columns.filter(
        (name) => !EXCLUDE_SYSTEM_FIELDS.includes(name) && !buttonDbFieldNames.has(name)
      ),
      ...fieldDbNames.filter((name) => !columns.includes(name)),
    ];
    const physicalHeaders = headers.filter((header) => columns.includes(header));

    archive.append(
      Readable.from(
        this.createTableDataCsvStream(
          db,
          queryBus,
          context,
          table,
          fields,
          headers,
          physicalHeaders,
          onProgress
        )
      ),
      { name: `${filePath}/${table.id}.csv` }
    );
  }

  private async *createTableDataCsvStream(
    db: ExportDb,
    queryBus: IQueryBus,
    context: IExecutionContext,
    table: TableRow,
    fields: FieldRow[],
    headers: string[],
    physicalHeaders: string[],
    onProgress?: ExportBaseProgressCallback
  ): AsyncGenerator<string> {
    yield `${headers.join(',')}\n`;
    let offset = 0;
    let processedRows = 0;
    let hasMore = true;

    while (hasMore) {
      const rawRows = await this.getRawRows(db, table.db_table_name, physicalHeaders, offset);
      if (rawRows.length === 0) {
        hasMore = false;
        break;
      }
      const recordFields = await this.getRecordFieldsByDbName(
        queryBus,
        context,
        table.id,
        fields,
        rawRows.flatMap((row) => (typeof row.__id === 'string' ? [row.__id] : []))
      );

      const rows = rawRows.map((rawRow) => {
        const recordId = String(rawRow.__id ?? '');
        const fieldValues = recordFields.get(recordId) ?? {};
        return Object.fromEntries(
          headers.map((header) => [
            header,
            serializeCsvValue(rawRow[header] !== undefined ? rawRow[header] : fieldValues[header]),
          ])
        );
      });

      yield stringify(rows, { columns: headers });
      offset += csvChunkSize;
      processedRows += rawRows.length;
      onProgress?.('table_data_progress', table.name, {
        type: 'progress',
        phase: 'table_data_progress',
        tableId: table.id,
        tableName: table.name,
        processedRows,
        batchProcessedRows: rawRows.length,
        currentBatch: Math.ceil(offset / csvChunkSize),
      });
    }
  }

  private async getPhysicalColumnNames(db: ExportDb, dbTableName: string): Promise<string[]> {
    const [schemaName, tableName] = splitDbTableName(dbTableName);
    const result = await sql<{ column_name: string }>`
      select "column_name"
      from "information_schema"."columns"
      where "table_schema" = ${schemaName}
        and "table_name" = ${tableName}
      order by "ordinal_position" asc
    `.execute(db);
    return result.rows.map((row) => row.column_name);
  }

  private async getRawRows(
    db: ExportDb,
    dbTableName: string,
    headers: string[],
    offset: number
  ): Promise<Array<Record<string, unknown>>> {
    const selectedColumns = headers.filter((header) => header !== '' && !header.includes('\u0000'));
    if (!selectedColumns.length) return [];
    const result = await sql<Record<string, unknown>>`
      select ${sql.join(selectedColumns.map((column) => sql.id(column)))}
      from ${identifier(dbTableName)}
      order by "__auto_number" asc
      limit ${csvChunkSize}
      offset ${offset}
    `.execute(db);
    return [...result.rows];
  }

  private async getRecordFieldsByDbName(
    queryBus: IQueryBus,
    context: IExecutionContext,
    tableId: string,
    fields: FieldRow[],
    recordIds: string[]
  ): Promise<Map<string, Record<string, unknown>>> {
    if (recordIds.length === 0) return new Map();

    const commandResult = ListTableRecordsQuery.create({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      selectedRecordIds: recordIds,
      limit: recordIds.length,
      ignoreViewQuery: true,
    });
    if (commandResult.isErr()) {
      throw new Error(commandResult.error.message);
    }

    const result = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
      context,
      commandResult.value
    );
    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    const dbFieldNameByFieldId = new Map(fields.map((field) => [field.id, field.db_field_name]));
    return new Map(
      result.value.records.map((record) => [
        record.id,
        Object.fromEntries(
          Object.entries(record.fields).flatMap(([fieldId, value]) => {
            const dbFieldName = dbFieldNameByFieldId.get(fieldId);
            return dbFieldName ? [[dbFieldName, value]] : [];
          })
        ),
      ])
    );
  }

  private async appendAttachments(
    db: ExportDb,
    filePath: string,
    tables: TableRow[],
    archive: archiver.Archiver
  ) {
    if (!tables.length) return;
    const tableIds = tables.map((table) => table.id);
    const result = await sql<AttachmentFileRow>`
      select at."token", at."name", a."path", a."thumbnail_path"
      from "attachments_table" at
      inner join "attachments" a on a."token" = at."token"
      where at."table_id" in (${sql.join(tableIds)})
        and a."deleted_time" is null
    `.execute(db);
    const bucket = StorageAdapter.getBucket(UploadType.Table);

    for (const attachment of result.rows) {
      const suffix = attachment.name?.split('.').pop();
      const archivePath = `${filePath}/${attachment.token}${suffix ? `.${suffix}` : ''}`;
      await this.appendFileToArchive(archive, bucket, attachment.path, archivePath);
    }

    const prefix = `${filePath}/thumbnail__`;
    for (const attachment of result.rows.filter((row) => row.thumbnail_path)) {
      const suffix = attachment.name?.split('.').pop() || 'jpg';
      const thumbnails = JSON.parse(attachment.thumbnail_path ?? '{}') as Record<string, string>;
      for (const thumbnailPath of Object.values(thumbnails).filter(Boolean)) {
        const fileName = thumbnailPath.split('/').pop();
        if (fileName) {
          await this.appendFileToArchive(
            archive,
            bucket,
            thumbnailPath,
            `${prefix}${fileName}.${suffix}`
          );
        }
      }
    }
  }

  private async appendAttachmentsDataCsv(
    db: ExportDb,
    filePath: string,
    tables: TableRow[],
    archive: archiver.Archiver
  ) {
    if (!tables.length) return;
    const tableIds = tables.map((table) => table.id);
    const result = await sql<AttachmentMetadataRow>`
      select distinct
        a."id",
        a."token",
        a."hash",
        a."size",
        a."mimetype",
        a."path",
        a."width",
        a."height",
        a."deleted_time",
        a."created_time",
        a."created_by",
        a."last_modified_by",
        a."thumbnail_path"
      from "attachments" a
      inner join "attachments_table" at on at."token" = a."token"
      where at."table_id" in (${sql.join(tableIds)})
        and a."deleted_time" is null
    `.execute(db);
    if (!result.rows.length) return;

    const csvStream = new PassThrough();
    const attachments = result.rows.map((row) => ({
      id: row.id,
      token: row.token,
      hash: row.hash,
      size: row.size,
      mimetype: row.mimetype,
      path: row.path,
      width: row.width,
      height: row.height,
      deletedTime: row.deleted_time,
      createdTime: row.created_time,
      createdBy: row.created_by,
      lastModifiedBy: row.last_modified_by,
      thumbnailPath: row.thumbnail_path,
    }));
    const headers = Object.keys(attachments[0]!);
    csvStream.write(`${headers.join(',')}\n`);
    archive.append(csvStream, { name: `${filePath}/attachments.csv` });
    csvStream.write(
      stringify(
        attachments.map((row) => {
          const values = row as Record<string, unknown>;
          return Object.fromEntries(
            headers.map((header) => [header, serializeCsvValue(values[header])])
          );
        }),
        { columns: headers }
      )
    );
    csvStream.end();
  }

  private async appendFileToArchive(
    archive: archiver.Archiver,
    bucket: string,
    s3Path: string,
    archivePath: string
  ): Promise<boolean> {
    try {
      const stream = await this.storageAdapter.downloadFile(bucket, s3Path);
      archive.append(stream, { name: archivePath });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to export file ${s3Path} to ${archivePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  private captureExportError(
    error: unknown,
    context: { baseId: string; includeData: boolean; baseName?: string }
  ) {
    const err = error instanceof Error ? error : new Error(String(error));
    const userId = this.cls.get('user.id');

    Sentry.withScope((scope) => {
      scope.setTag('feature', 'base-export-v2');
      scope.setContext('base-export-v2', {
        ...context,
        userId,
      });
      scope.setLevel?.('error');
      Sentry.captureException(err);
    });

    this.logger.error(`export v2 base zip failed: ${err.message}`, err.stack ?? undefined);
  }

  private async notifyExportResult(
    baseId: string,
    message: string | ILocalization<I18nPath>,
    result?: {
      status: 'success' | 'failed';
      previewUrl?: string;
      attachment?: { name: string; path: string };
      errorMessage?: string;
    }
  ) {
    const userId = this.cls.get('user.id');
    await this.eventEmitterService.emit(Events.BASE_EXPORT_COMPLETE, {
      status: result?.status,
      previewUrl: result?.previewUrl,
      attachment: result?.attachment,
      errorMessage: result?.errorMessage,
    });
    await this.notificationService.sendExportBaseResultNotify({
      baseId,
      toUserId: userId,
      message,
    });
  }
}
