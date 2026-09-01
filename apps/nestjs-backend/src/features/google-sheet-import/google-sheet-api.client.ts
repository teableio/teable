import type {
  IGoogleGridSampleResponse,
  IGoogleSampleRowsResponse,
  IGoogleSpreadsheetMeta,
  IGoogleValuesResponse,
} from './google-sheet.types';

const sheetsApiBaseUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
// Sheets API read quota is 60 requests/minute per user; stay slightly under it.
const minRequestIntervalMs = 1_050;
// Base wait after a 429; Google recommends exponential backoff.
const rateLimitWaitMs = 5_000;
const maxRetries = 3;
// Stall-breaker, mirrored from the Airtable client: refreshed on every body
// chunk so only a silently dropped connection aborts, never a slow response.
const requestTimeoutMs = 30_000;

export class GoogleSheetApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Auth mode of the failing request; 403/404 mean different things per mode. */
    public readonly authMode: 'oauth' | 'apiKey' = 'oauth'
  ) {
    super(message);
    this.name = 'GoogleSheetApiError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A1 column letter for a 1-based column index (1 -> A, 27 -> AA). */
export const columnIndexToLetter = (index: number): string => {
  let remaining = index;
  let letter = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letter = String.fromCharCode(65 + digit) + letter;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letter;
};

/** Quote a sheet title for A1 notation ('It''s a sheet'!A1:B2). */
const quoteSheetTitle = (title: string) => `'${title.replace(/'/g, "''")}'`;

/**
 * The token is fetched per request so integration-backed imports keep working
 * past the ~60 minute Google OAuth token lifetime (the provider refreshes
 * server-side).
 */
export type IGoogleSheetAccessTokenProvider = () => Promise<string> | string;

/**
 * oauth: per-user token, reads exactly the files granted to it (drive.file).
 * apiKey: no user at all — the Sheets API serves publicly-shared spreadsheets
 * ("anyone with the link") to a plain API key, which is how link-only imports
 * work without any Google account or Picker step.
 */
export type IGoogleSheetClientAuth =
  | { mode: 'oauth'; getAccessToken: IGoogleSheetAccessTokenProvider }
  | { mode: 'apiKey'; apiKey: string };

export class GoogleSheetApiClient {
  private lastRequestAt = 0;
  /** Serializes throttle slots: concurrent callers queue instead of bursting. */
  private throttleTail: Promise<void> = Promise.resolve();

  constructor(private readonly auth: IGoogleSheetClientAuth) {}

  get authMode(): IGoogleSheetClientAuth['mode'] {
    return this.auth.mode;
  }

  /** Spreadsheet title plus every tab's id, title and declared grid size. */
  async getSpreadsheetMeta(spreadsheetId: string): Promise<IGoogleSpreadsheetMeta> {
    const params = new URLSearchParams({
      fields: 'properties(title),sheets(properties(sheetId,title,sheetType,gridProperties))',
    });
    return await this.request<IGoogleSpreadsheetMeta>(
      `/${encodeURIComponent(spreadsheetId)}?${params.toString()}`
    );
  }

  /**
   * The first rows of one tab with cell values AND number formats — the only
   * request that carries formats, used to infer column types (a date column is
   * a number column with a DATE number format).
   */
  async getGridSample(
    spreadsheetId: string,
    sheetTitle: string,
    startRow: number,
    endRow: number,
    columnCount: number
  ): Promise<IGoogleGridSampleResponse> {
    const range = `${quoteSheetTitle(sheetTitle)}!A${startRow}:${columnIndexToLetter(columnCount)}${endRow}`;
    const params = new URLSearchParams({
      includeGridData: 'true',
      ranges: range,
      fields:
        'sheets(data(rowData(values(formattedValue,effectiveValue,effectiveFormat.numberFormat.type))))',
    });
    return await this.request<IGoogleGridSampleResponse>(
      `/${encodeURIComponent(spreadsheetId)}?${params.toString()}`
    );
  }

  /**
   * The first rows of MANY tabs in one request (a multi-range
   * spreadsheets.get), so a structure preview never costs one throttle slot
   * per tab.
   */
  async getSampleRows(
    spreadsheetId: string,
    sheetTitles: string[],
    rowCount: number,
    columnCount: number
  ): Promise<IGoogleSampleRowsResponse> {
    const params = new URLSearchParams({
      includeGridData: 'true',
      fields: 'sheets(properties(sheetId),data(rowData(values(formattedValue))))',
    });
    // A bounded rectangle, not a row-only range: `1:6` would return every
    // populated column, and a very wide grid times 30 tabs downloads far more
    // than the preview can ever show.
    const lastColumn = columnIndexToLetter(columnCount);
    for (const title of sheetTitles) {
      params.append('ranges', `${quoteSheetTitle(title)}!A1:${lastColumn}${rowCount}`);
    }
    return await this.request<IGoogleSampleRowsResponse>(
      `/${encodeURIComponent(spreadsheetId)}?${params.toString()}`
    );
  }

  /**
   * One chunk of raw row values ([startRow, endRow], 1-based, inclusive).
   * UNFORMATTED_VALUE + SERIAL_NUMBER: numbers/booleans arrive typed and
   * date cells arrive as day serials; trailing empty rows/cells are omitted.
   */
  async getValues(
    spreadsheetId: string,
    sheetTitle: string,
    startRow: number,
    endRow: number,
    columnCount: number
  ): Promise<IGoogleValuesResponse> {
    const range = `${quoteSheetTitle(sheetTitle)}!A${startRow}:${columnIndexToLetter(columnCount)}${endRow}`;
    const params = new URLSearchParams({
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
      majorDimension: 'ROWS',
    });
    return await this.request<IGoogleValuesResponse>(
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${params.toString()}`
    );
  }

  private throttle(): Promise<void> {
    // Chained, not check-then-set: N concurrent callers previously read the
    // same lastRequestAt, slept to the same instant and fired as a burst —
    // defeating the shared public-key client's whole purpose. Each caller now
    // takes the next slot on the chain.
    const slot = this.throttleTail.then(async () => {
      const wait = this.lastRequestAt + minRequestIntervalMs - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      this.lastRequestAt = Date.now();
    });
    // Keep the chain alive even if a caller's request later fails.
    this.throttleTail = slot.catch(() => undefined);
    return slot;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async request<T>(path: string): Promise<T> {
    let attempt = 0;
    // Retry budget covers both rate-limit waits and transient network errors.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.throttle();
      let requestPath = path;
      const headers: Record<string, string> = {};
      if (this.auth.mode === 'oauth') {
        headers.Authorization = `Bearer ${await this.auth.getAccessToken()}`;
      } else {
        requestPath += `${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(this.auth.apiKey)}`;
      }
      const controller = new AbortController();
      const stallTimer = setTimeout(
        () => controller.abort(new Error(`no response data for ${requestTimeoutMs}ms`)),
        requestTimeoutMs
      );
      let response: Response;
      let bodyText: string;
      try {
        response = await fetch(`${sheetsApiBaseUrl}${requestPath}`, {
          headers,
          signal: controller.signal,
        });
        bodyText = await this.readBody(response, stallTimer);
        if (response.ok) {
          return JSON.parse(bodyText) as T;
        }
      } catch (e) {
        if (attempt >= maxRetries) {
          throw new GoogleSheetApiError(
            `Failed to reach the Google Sheets API: ${e instanceof Error ? e.message : 'network error'}`,
            0,
            this.auth.mode
          );
        }
        await sleep(1000 * 2 ** attempt);
        attempt++;
        continue;
      } finally {
        clearTimeout(stallTimer);
      }

      if (response.status === 429 && attempt < maxRetries) {
        await sleep(rateLimitWaitMs * 2 ** attempt);
        attempt++;
        continue;
      }
      if (response.status >= 500 && attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        attempt++;
        continue;
      }
      throw new GoogleSheetApiError(
        this.parseErrorMessage(bodyText) ||
          `Google Sheets API request failed with status ${response.status}`,
        response.status,
        this.auth.mode
      );
    }
  }

  /** Read the body chunkwise, refreshing the stall timer on every chunk. */
  private async readBody(response: Response, stallTimer: NodeJS.Timeout): Promise<string> {
    if (!response.body) {
      return '';
    }
    const chunks: Buffer[] = [];
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      stallTimer.refresh();
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private parseErrorMessage(bodyText: string): string | undefined {
    try {
      const body = JSON.parse(bodyText) as { error?: { message?: string } };
      return body.error?.message;
    } catch {
      return undefined;
    }
  }
}
