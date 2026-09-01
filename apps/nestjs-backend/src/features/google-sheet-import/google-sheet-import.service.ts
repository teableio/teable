import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { FieldKeyType, ViewType } from '@teable/core';
import type {
  IImportGoogleSheetAnalyzeRo,
  IImportGoogleSheetAnalyzeVo,
  IImportGoogleSheetIssue,
  IImportGoogleSheetRo,
  IImportGoogleSheetVo,
} from '@teable/openapi';
import { BaseService } from '../base/base.service';
import { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import { TableOpenApiV2Service } from '../table/open-api/table-open-api-v2.service';
import { GoogleSheetApiClient } from './google-sheet-api.client';
import {
  buildFieldRos,
  convertCellValue,
  inferColumnPlans,
  type IGoogleSheetColumnPlan,
} from './google-sheet-schema';
import {
  GOOGLE_SHEET_IMPORT_TOKEN_RESOLVER,
  type IGoogleSheetImportTokenResolver,
} from './google-sheet-token-resolver';
import type { IGoogleSheetCellValue, IGoogleSheetProperties } from './google-sheet.types';

export interface IGoogleSheetImportProgress {
  phase: string;
  detail?: string;
  tableName?: string;
  tableIndex?: number;
  totalTables?: number;
  processedRows?: number;
  totalRows?: number;
  importedRecords?: number;
}

export type IGoogleSheetImportProgressReporter = (progress: IGoogleSheetImportProgress) => void;

/**
 * Thrown when the import fails after at least one table was fully imported.
 * Carries everything completed so far so the caller can report a partial
 * result instead of pretending nothing happened. A brand-new base with zero
 * imported tables is deleted instead (pure junk), so this error always means
 * "there is something worth keeping".
 */
export class GoogleSheetImportPartialError extends Error {
  constructor(
    public readonly cause: unknown,
    public readonly partial: Pick<IImportGoogleSheetVo, 'base' | 'tableIdMap' | 'issues'>
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'GoogleSheetImportPartialError';
  }
}

// Rows fetched per values.get request. Sized so a wide sheet stays a few MB
// per response while a tall import needs few requests (quota: ~60 req/min).
const fetchChunkRows = 2000;
// Records per createRecords call, matching the CSV importer's chunking.
const insertBatchSize = 500;
// Tabs covered by the analyze sample-rows preview (one A1 range each in a
// single request URL — the cap keeps that URL bounded).
const maxSamplePreviewSheets = 30;
// Rows per tab in that preview: a probable header row plus five data rows,
// matching the onboarding file-analyze convention (TABULAR_SAMPLE_ROWS). Raw
// rows on purpose — sheets often open with banners or blank rows, so row 1
// alone routinely is NOT the header.
const samplePreviewRowsPerSheet = 6;
// Columns per preview row. The summary renders at most ~160 chars per row, so
// 50 columns is already beyond what can surface — the cap only stops a very
// wide grid from inflating the response.
const samplePreviewColumnsPerSheet = 50;
// Rows of the format-carrying sample used for type inference.
const sampleRowCount = 200;
// Hard cap on grid columns considered; beyond this the sample payload and
// created table stop being sensible.
const maxColumns = 300;

@Injectable()
export class GoogleSheetImportService {
  private static readonly publicClients = new Map<string, GoogleSheetApiClient>();

  private readonly logger = new Logger(GoogleSheetImportService.name);

  constructor(
    private readonly baseService: BaseService,
    private readonly tableOpenApiV2Service: TableOpenApiV2Service,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    @Optional()
    @Inject(GOOGLE_SHEET_IMPORT_TOKEN_RESOLVER)
    private readonly tokenResolver?: IGoogleSheetImportTokenResolver
  ) {}

  /**
   * Builds the per-request access token provider. With an integrationId the
   * token stays server-side and is refreshed by the resolver; a raw
   * accessToken (direct API usage) is used as-is.
   */
  private createClient(ro: { integrationId?: string; accessToken?: string }): GoogleSheetApiClient {
    if (ro.integrationId) {
      const resolver = this.tokenResolver;
      if (!resolver) {
        throw new BadRequestException(
          'Google Sheets integrations are not available on this instance'
        );
      }
      const integrationId = ro.integrationId;
      return new GoogleSheetApiClient({
        mode: 'oauth',
        getAccessToken: () => resolver.resolveAccessToken(integrationId),
      });
    }
    if (!ro.accessToken) {
      // No credential at all: public mode. The Sheets API serves spreadsheets
      // shared as "anyone with the link" to a plain API key, so public sheets
      // import with just their URL — no Google account, no Picker. Requires a
      // DEDICATED key: the Picker key is typically referrer-restricted, which
      // blocks server-side calls — falling back to it would make public mode
      // fail with a misleading "share the sheet" error on the standard setup.
      const publicApiKey = process.env.GOOGLE_SHEET_PUBLIC_API_KEY;
      if (publicApiKey) {
        // One shared client per key: its 1.05s request throttle then applies
        // process-wide, so the permissionless analyze route cannot be used to
        // burn the instance's shared Google quota with parallel requests.
        const cached = GoogleSheetImportService.publicClients.get(publicApiKey);
        if (cached) return cached;
        const client = new GoogleSheetApiClient({ mode: 'apiKey', apiKey: publicApiKey });
        GoogleSheetImportService.publicClients.set(publicApiKey, client);
        return client;
      }
      throw new BadRequestException(
        'Provide integrationId or accessToken — public-link imports are not configured on this instance'
      );
    }
    const accessToken = ro.accessToken;
    return new GoogleSheetApiClient({ mode: 'oauth', getAccessToken: () => accessToken });
  }

  private async getSheetProperties(
    client: GoogleSheetApiClient,
    spreadsheetId: string
  ): Promise<{ title: string; sheets: IGoogleSheetProperties[] }> {
    const meta = await client.getSpreadsheetMeta(spreadsheetId);
    const sheets = (meta.sheets ?? [])
      .map((sheet) => sheet.properties)
      .filter((properties): properties is IGoogleSheetProperties => !!properties)
      // Chart (OBJECT) and DATA_SOURCE tabs have no A1 grid: sampling them is a
      // Sheets API 400 that would abort the whole import, so they are not
      // importable and never listed.
      .filter((properties) => !properties.sheetType || properties.sheetType === 'GRID');
    return { title: meta.properties?.title ?? 'Imported spreadsheet', sheets };
  }

  async analyze(ro: IImportGoogleSheetAnalyzeRo): Promise<IImportGoogleSheetAnalyzeVo> {
    const client = this.createClient(ro);
    const { title, sheets } = await this.getSheetProperties(client, ro.spreadsheetId);
    const samplesBySheetId = ro.includeSampleRows
      ? await this.getSampleRowTexts(client, ro.spreadsheetId, sheets)
      : undefined;
    return {
      spreadsheet: {
        id: ro.spreadsheetId,
        title,
        sheets: sheets.map((sheet) => ({
          sheetId: sheet.sheetId,
          title: sheet.title,
          rowCount: sheet.gridProperties?.rowCount ?? 0,
          columnCount: sheet.gridProperties?.columnCount ?? 0,
          ...(samplesBySheetId?.has(sheet.sheetId)
            ? { sampleRows: samplesBySheetId.get(sheet.sheetId) }
            : {}),
        })),
      },
    };
  }

  /**
   * Best-effort structure preview: one multi-range request for every tab's
   * first rows. A failure only drops the preview — the tab listing (the
   * reason analyze was called) must never fail with it.
   */
  private async getSampleRowTexts(
    client: GoogleSheetApiClient,
    spreadsheetId: string,
    sheets: IGoogleSheetProperties[]
  ): Promise<Map<number, string[][]> | undefined> {
    // A ranges param per tab: bound it so a pathological spreadsheet cannot
    // build an oversized request URL. The first tabs are plenty for a preview.
    const capped = sheets.slice(0, maxSamplePreviewSheets);
    if (capped.length === 0) {
      return undefined;
    }
    try {
      const response = await client.getSampleRows(
        spreadsheetId,
        capped.map((sheet) => sheet.title),
        samplePreviewRowsPerSheet,
        samplePreviewColumnsPerSheet
      );
      const bySheetId = new Map<number, string[][]>();
      for (const sheet of response.sheets ?? []) {
        if (sheet.properties?.sheetId === undefined) continue;
        const rows = (sheet.data?.[0]?.rowData ?? []).map((row) => {
          // formattedValue is absent for empty cells; keep positions (cells
          // align to columns) but drop the trailing empty run the grid pads
          // each row with.
          const texts = (row.values ?? []).map((cell) => cell.formattedValue ?? '');
          while (texts.length > 0 && texts[texts.length - 1] === '') {
            texts.pop();
          }
          return texts;
        });
        // Same trim vertically: blank LEADING rows stay (they are structure —
        // "the header is not in row 1"), the trailing empty run goes.
        while (rows.length > 0 && rows[rows.length - 1].length === 0) {
          rows.pop();
        }
        bySheetId.set(sheet.properties.sheetId, rows);
      }
      return bySheetId;
    } catch (error) {
      this.logger.warn(`google-sheet analyze sample-rows preview failed: ${error}`);
      return undefined;
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- orchestrates the linear import pipeline
  async importSpreadsheet(
    ro: IImportGoogleSheetRo,
    onProgress?: IGoogleSheetImportProgressReporter,
    /** Polled between chunks: a disconnected SSE client stops the crawl. */
    isAborted?: () => boolean
  ): Promise<IImportGoogleSheetVo> {
    const importRecords = ro.importRecords ?? true;
    const progress = (event: IGoogleSheetImportProgress) => onProgress?.(event);
    const client = this.createClient(ro);
    const startedAt = Date.now();

    progress({ phase: 'fetching_schema' });
    const { title, sheets } = await this.getSheetProperties(client, ro.spreadsheetId);
    const selectedSheets = ro.sheetIds?.length
      ? sheets.filter((sheet) => ro.sheetIds!.includes(sheet.sheetId))
      : sheets;
    if (selectedSheets.length === 0) {
      throw new BadRequestException('The spreadsheet has no importable tabs');
    }
    const credentialSource = ro.integrationId ? 'integration' : ro.accessToken ? 'token' : 'public';
    this.logger.log(
      `[google-sheet-import] start spreadsheet=${ro.spreadsheetId} target=${ro.baseId ?? 'new'} ` +
        `tabs=${selectedSheets.length}/${sheets.length} source=${credentialSource} ` +
        `records=${importRecords}`
    );

    let base;
    if (ro.baseId) {
      base = await this.baseService.getBaseById(ro.baseId);
    } else {
      if (!ro.spaceId) {
        throw new BadRequestException('spaceId is required when baseId is not provided.');
      }
      progress({ phase: 'creating_base', detail: ro.baseName ?? title });
      base = await this.baseService.createBase({
        spaceId: ro.spaceId,
        name: ro.baseName ?? title,
      });
    }

    const issues: IImportGoogleSheetIssue[] = [];
    const tableIdMap: Record<string, string> = {};
    const totalTables = selectedSheets.length;

    try {
      for (const [index, sheet] of selectedSheets.entries()) {
        if (isAborted?.()) {
          throw new BadRequestException('Import aborted: the client disconnected');
        }
        const tableIndex = index + 1;
        const declaredColumnCount = sheet.gridProperties?.columnCount ?? 26;
        const columnCount = Math.min(declaredColumnCount, maxColumns);
        const rowCount = sheet.gridProperties?.rowCount ?? 0;
        if (declaredColumnCount > maxColumns) {
          // Never truncate silently: the whole importer's contract is that any
          // dropped data shows up in the issues summary.
          issues.push({
            code: 'columnsTruncated',
            sheetName: sheet.title,
            count: declaredColumnCount - maxColumns,
          });
        }

        progress({
          phase: 'creating_table',
          tableName: sheet.title,
          tableIndex,
          totalTables,
        });
        let sampled = await this.sampleColumns(client, ro.spreadsheetId, sheet.title, {
          startRow: 1,
          rowCount,
          columnCount,
        });
        if (sampled.columns.length === 0 && rowCount > sampleRowCount) {
          // The first-rows sample saw nothing, but the sample is only a window
          // — a sheet whose data starts further down (title rows, log-style
          // sheets) must not be dropped as empty. Scan for the first non-empty
          // row; empty-range responses are tiny, so this is cheap.
          const firstDataRow = await this.findFirstDataRow(
            client,
            ro.spreadsheetId,
            sheet.title,
            sampleRowCount + 1,
            rowCount,
            columnCount
          );
          if (firstDataRow !== undefined) {
            sampled = await this.sampleColumns(client, ro.spreadsheetId, sheet.title, {
              startRow: firstDataRow,
              rowCount,
              columnCount,
            });
          }
        }
        const { columns, headerRow } = sampled;
        if (columns.length === 0) {
          issues.push({ code: 'sheetSkipped', sheetName: sheet.title, reason: 'the tab is empty' });
          continue;
        }

        const table = await this.tableOpenApiV2Service.createTable(base.id, {
          name: sheet.title,
          fieldKeyType: FieldKeyType.Id,
          fields: buildFieldRos(columns),
          views: [{ name: 'Grid view', type: ViewType.Grid }],
          records: [],
        });

        if (importRecords) {
          try {
            await this.importSheetRecords({
              client,
              ro,
              sheet,
              columns,
              isAborted,
              // createTable returns fields in creation order, matching `columns`.
              fieldIds: (table.fields ?? []).map((field) => field.id),
              tableId: table.id,
              tableIndex,
              totalTables,
              rowCount,
              columnCount,
              headerRow,
              issues,
              progress,
            });
          } catch (recordsError) {
            // Don't orphan a half-filled table the partial result won't list:
            // best-effort remove it (trash) before surfacing the failure.
            await this.tableOpenApiV2Service
              .deleteTable(base.id, table.id)
              .catch((cleanupError) => {
                this.logger.warn(
                  `[google-sheet-import] failed to clean up partial table ${table.id}: ` +
                    `${cleanupError instanceof Error ? cleanupError.message : cleanupError}`
                );
              });
            throw recordsError;
          }
        }
        // Recorded only after the records finished: a mid-records failure must
        // not count this table as "fully imported" in the partial result (and
        // on the new-base flow, a first-table record failure still deletes the
        // otherwise-empty base).
        tableIdMap[String(sheet.sheetId)] = table.id;
      }
      if (Object.keys(tableIdMap).length === 0) {
        // Every selected tab was skipped (all empty): reporting success would
        // leave the user a zero-table base. Route through the failure handler,
        // which deletes a freshly created base.
        throw new BadRequestException('No importable data found in the selected tabs');
      }
    } catch (error) {
      await this.handleImportFailure(error, ro, base, tableIdMap, issues);
    }

    this.logImportSummary(ro, base.id, tableIdMap, issues, startedAt);
    progress({ phase: 'import_done', detail: base.name });
    return { base, tableIdMap, issues };
  }

  /**
   * Mirror of the Airtable importer's summary logging: one `done` line with an
   * issues-by-code breakdown plus one line per issue, all under the
   * `[google-sheet-import]` prefix — the SigNoz dashboards/alerts that watch
   * `[airtable-import]` follow the same shape and channel for this importer.
   * Issues otherwise only travel down the SSE stream, invisible to monitoring.
   */
  private logImportSummary(
    ro: IImportGoogleSheetRo,
    baseId: string,
    tableIdMap: Record<string, string>,
    issues: IImportGoogleSheetIssue[],
    startedAt: number
  ): void {
    const byCode = issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.code] = (acc[issue.code] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(
      `[google-sheet-import] done spreadsheet=${ro.spreadsheetId} base=${baseId} ` +
        `tables=${Object.keys(tableIdMap).length} issues=${issues.length} ` +
        `byCode=${JSON.stringify(byCode)} durationMs=${Date.now() - startedAt}`
    );
    for (const issue of issues) {
      const target = `${issue.sheetName}${issue.fieldName ? `/${issue.fieldName}` : ''}`;
      const detail = `${issue.count !== undefined ? ` count=${issue.count}` : ''}${
        issue.reason ? ` reason=${issue.reason}` : ''
      }`;
      const line = `[google-sheet-import] ${issue.code} base=${baseId} ${target}${detail}`;
      // Structural losses (whole tab skipped, columns cut) warn; per-value
      // drops are expected type-coercion noise and stay at info.
      if (issue.code === 'sheetSkipped' || issue.code === 'columnsTruncated') {
        this.logger.warn(line);
      } else {
        this.logger.log(line);
      }
    }
  }

  private async importSheetRecords(params: {
    client: GoogleSheetApiClient;
    ro: IImportGoogleSheetRo;
    sheet: IGoogleSheetProperties;
    columns: IGoogleSheetColumnPlan[];
    fieldIds: string[];
    tableId: string;
    tableIndex: number;
    totalTables: number;
    rowCount: number;
    /** Capped grid width; fetched in full so data beyond the planned columns is detected. */
    columnCount: number;
    /** 1-based grid row used as the header; data starts on the next row. */
    headerRow: number;
    issues: IImportGoogleSheetIssue[];
    progress: (event: IGoogleSheetImportProgress) => void;
    isAborted?: () => boolean;
  }) {
    const {
      client,
      ro,
      sheet,
      columns,
      fieldIds,
      tableId,
      tableIndex,
      totalTables,
      rowCount,
      columnCount,
      headerRow,
      issues,
      progress,
      isAborted,
    } = params;

    // Progress is measured in SCANNED grid rows so the bar always completes —
    // the declared grid height includes empty padding (new sheets are padded
    // to 1000 rows), so counting only returned rows makes sparse sheets look
    // stuck at 0. The count of records actually written travels separately as
    // importedRecords.
    const totalRows = Math.max(rowCount - headerRow, 0);
    progress({
      phase: 'table_records_start',
      tableName: sheet.title,
      tableIndex,
      totalTables,
      totalRows,
      importedRecords: 0,
    });

    const droppedByField = new Map<string, number>();
    // Fetch the full (capped) grid width, not just the sampled columns: a
    // column that is empty for the whole sample window but holds data further
    // down must be DETECTED and reported, not silently never fetched.
    const plannedWidth = Math.max(...columns.map((column) => column.index)) + 1;
    const fetchWidth = Math.max(plannedWidth, Math.min(columnCount, maxColumns));
    const unplannedColumnsWithData = new Set<number>();
    let processedRows = 0;
    let importedRecords = 0;

    // rowCount is the declared grid height (an upper bound), and the API omits
    // trailing empty rows per chunk, so empty tail chunks are cheap.
    for (let startRow = headerRow + 1; startRow <= rowCount; startRow += fetchChunkRows) {
      if (isAborted?.()) {
        // The SSE client is gone: nobody can see progress or the result, and a
        // padded multi-million-row grid would otherwise keep burning the
        // Google quota for nothing.
        throw new BadRequestException('Import aborted: the client disconnected');
      }
      const endRow = Math.min(startRow + fetchChunkRows - 1, rowCount);
      const { values = [] } = await client.getValues(
        ro.spreadsheetId,
        sheet.title,
        startRow,
        endRow,
        fetchWidth
      );
      for (const row of values) {
        for (let index = plannedWidth; index < row.length; index++) {
          const cell = row[index];
          if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
            unplannedColumnsWithData.add(index);
          }
        }
      }

      const payloads = this.buildRecordPayloads(values, columns, fieldIds, droppedByField);
      for (let offset = 0; offset < payloads.length; offset += insertBatchSize) {
        const batch = payloads.slice(offset, offset + insertBatchSize);
        // Teable assigns each create batch a descending order, which flips the
        // rows in the view. Send the batch reversed so records keep the source
        // order.
        await this.recordOpenApiV2Service.createRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records: batch.slice().reverse(),
        });
      }

      processedRows += endRow - startRow + 1;
      importedRecords += payloads.length;
      progress({
        phase: 'table_records_progress',
        tableName: sheet.title,
        tableIndex,
        totalTables,
        processedRows,
        totalRows,
        importedRecords,
      });
    }

    for (const [fieldName, count] of droppedByField) {
      issues.push({
        code: 'valuesDropped',
        sheetName: sheet.title,
        fieldName,
        count,
        reason: 'the cell value does not fit the inferred column type',
      });
    }
    if (unplannedColumnsWithData.size > 0) {
      // Columns invisible to the 200-row type sample but carrying data below
      // it: no field was created for them, so their values were not imported.
      issues.push({
        code: 'columnsTruncated',
        sheetName: sheet.title,
        count: unplannedColumnsWithData.size,
      });
    }

    progress({
      phase: 'table_records_done',
      tableName: sheet.title,
      tableIndex,
      totalTables,
      processedRows: totalRows,
      totalRows,
      importedRecords,
    });
  }

  /**
   * Fetch a format-carrying sample window and infer the column plans from it.
   * headerRow is the 1-based ABSOLUTE grid row used as the header (leading
   * blank rows inside the window are skipped by inferColumnPlans).
   */
  private async sampleColumns(
    client: GoogleSheetApiClient,
    spreadsheetId: string,
    sheetTitle: string,
    window: { startRow: number; rowCount: number; columnCount: number }
  ): Promise<{ columns: IGoogleSheetColumnPlan[]; headerRow: number }> {
    const endRow = Math.min(window.startRow + sampleRowCount - 1, Math.max(window.rowCount, 1));
    const sample = await client.getGridSample(
      spreadsheetId,
      sheetTitle,
      window.startRow,
      Math.max(endRow, window.startRow),
      Math.max(window.columnCount, 1)
    );
    const sampleRows = sample.sheets?.[0]?.data?.[0]?.rowData?.map((row) => row.values ?? []) ?? [];
    const { plans, headerOffset } = inferColumnPlans(sampleRows);
    return { columns: plans, headerRow: window.startRow + headerOffset };
  }

  /**
   * First 1-based grid row in [startRow, rowCount] with any non-empty cell, or
   * undefined when the rest of the sheet is blank. values.get trims trailing
   * empty rows per range, so scanning an empty tail costs tiny responses.
   */
  private async findFirstDataRow(
    client: GoogleSheetApiClient,
    spreadsheetId: string,
    sheetTitle: string,
    startRow: number,
    rowCount: number,
    columnCount: number
  ): Promise<number | undefined> {
    for (let chunkStart = startRow; chunkStart <= rowCount; chunkStart += fetchChunkRows) {
      const endRow = Math.min(chunkStart + fetchChunkRows - 1, rowCount);
      const { values = [] } = await client.getValues(
        spreadsheetId,
        sheetTitle,
        chunkStart,
        endRow,
        Math.max(columnCount, 1)
      );
      const index = values.findIndex((row) =>
        row.some((cell) => cell !== '' && cell !== null && cell !== undefined)
      );
      if (index >= 0) return chunkStart + index;
    }
    return undefined;
  }

  /**
   * Failure teardown: a brand-new base with nothing imported is deleted
   * (best-effort) and the original error propagates; once any table was fully
   * imported the error is wrapped so the caller can report the partial result
   * instead of losing it.
   */
  private async handleImportFailure(
    error: unknown,
    ro: IImportGoogleSheetRo,
    base: IImportGoogleSheetVo['base'],
    tableIdMap: Record<string, string>,
    issues: IImportGoogleSheetIssue[]
  ): Promise<never> {
    const createdBase = !ro.baseId;
    if (createdBase && Object.keys(tableIdMap).length === 0) {
      await this.baseService.deleteBase(base.id).catch((cleanupError) => {
        this.logger.warn(
          `[google-sheet-import] failed to clean up empty base ${base.id}: ` +
            `${cleanupError instanceof Error ? cleanupError.message : cleanupError}`
        );
      });
      throw error;
    }
    throw new GoogleSheetImportPartialError(error, { base, tableIdMap, issues });
  }

  private buildRecordPayloads(
    rows: IGoogleSheetCellValue[][],
    columns: IGoogleSheetColumnPlan[],
    fieldIds: string[],
    droppedByField: Map<string, number>
  ): { fields: Record<string, unknown> }[] {
    const payloads: { fields: Record<string, unknown> }[] = [];
    for (const row of rows) {
      const fields: Record<string, unknown> = {};
      // Keyed on SOURCE content, not converted values: a row whose only cell
      // is an unchecked checkbox (converts to empty) or a dropped value must
      // still produce a record — silently losing whole rows is worse than an
      // empty-looking record. Only fully blank grid rows (padding) skip.
      let hasSourceContent = false;
      columns.forEach((column, columnIndex) => {
        const fieldId = fieldIds[columnIndex];
        if (!fieldId) return;
        const raw = row[column.index];
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
          hasSourceContent = true;
        }
        const { value, dropped } = convertCellValue(raw, column);
        if (dropped) {
          droppedByField.set(column.name, (droppedByField.get(column.name) ?? 0) + 1);
          return;
        }
        if (value === undefined) return;
        fields[fieldId] = value;
      });
      if (hasSourceContent) payloads.push({ fields });
    }
    return payloads;
  }
}
