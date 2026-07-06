import type {
  IAirtableBaseItem,
  IAirtableBaseSchemaResponse,
  IAirtableListBasesResponse,
  IAirtableListRecordsResponse,
  IAirtableRecord,
  IAirtableTable,
} from './airtable.types';

const airtableApiBaseUrl = 'https://api.airtable.com/v0';
// Airtable allows 5 requests/second per base; stay slightly under it.
const minRequestIntervalMs = 220;
// Airtable documents a 30s penalty after a 429 response.
const rateLimitWaitMs = 30_000;
const maxRetries = 3;
const recordsPageSize = 100;

export class AirtableApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly type?: string
  ) {
    super(message);
    this.name = 'AirtableApiError';
  }
}

/** The list-records pagination iterator expired (HTTP 422); listing must restart. */
export class AirtableIteratorExpiredError extends AirtableApiError {
  constructor() {
    super('Airtable records iterator expired', 422, 'LIST_RECORDS_ITERATOR_NOT_AVAILABLE');
    this.name = 'AirtableIteratorExpiredError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The token is fetched per request so integration-backed imports keep working
 * past the ~60 minute Airtable OAuth token lifetime (the provider refreshes
 * server-side).
 */
export type IAirtableAccessTokenProvider = () => Promise<string> | string;

export class AirtableApiClient {
  private lastRequestAt = 0;

  constructor(private readonly getAccessToken: IAirtableAccessTokenProvider) {}

  async listBases(): Promise<IAirtableBaseItem[]> {
    const bases: IAirtableBaseItem[] = [];
    let offset: string | undefined;
    do {
      const query = offset ? `?offset=${encodeURIComponent(offset)}` : '';
      const res = await this.request<IAirtableListBasesResponse>(`/meta/bases${query}`);
      bases.push(...res.bases);
      offset = res.offset;
    } while (offset);
    return bases;
  }

  async getBaseSchema(airtableBaseId: string): Promise<IAirtableTable[]> {
    const res = await this.request<IAirtableBaseSchemaResponse>(
      `/meta/bases/${encodeURIComponent(airtableBaseId)}/tables`
    );
    return res.tables;
  }

  /**
   * Yields pages of records (100 per page). Throws AirtableIteratorExpiredError
   * when the pagination iterator expires; the caller may restart the listing
   * and deduplicate already-processed records by id.
   */
  async *listRecords(airtableBaseId: string, tableId: string): AsyncGenerator<IAirtableRecord[]> {
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({
        pageSize: String(recordsPageSize),
        returnFieldsByFieldId: 'true',
        cellFormat: 'json',
      });
      if (offset) {
        params.set('offset', offset);
      }
      const res = await this.request<IAirtableListRecordsResponse>(
        `/${encodeURIComponent(airtableBaseId)}/${encodeURIComponent(tableId)}?${params.toString()}`
      );
      if (res.records.length > 0) {
        yield res.records;
      }
      offset = res.offset;
    } while (offset);
  }

  private async throttle() {
    const wait = this.lastRequestAt + minRequestIntervalMs - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastRequestAt = Date.now();
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async request<T>(path: string): Promise<T> {
    let attempt = 0;
    // Retry budget covers both rate-limit waits and transient network errors.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.throttle();
      const accessToken = await this.getAccessToken();
      let response: Response;
      try {
        response = await fetch(`${airtableApiBaseUrl}${path}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (e) {
        if (attempt >= maxRetries) {
          throw new AirtableApiError(
            `Failed to reach the Airtable API: ${e instanceof Error ? e.message : 'network error'}`,
            0
          );
        }
        await sleep(1000 * 2 ** attempt);
        attempt++;
        continue;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      const errorBody = await this.parseError(response);
      if (response.status === 429 && attempt < maxRetries) {
        await sleep(rateLimitWaitMs);
        attempt++;
        continue;
      }
      if (response.status >= 500 && attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        attempt++;
        continue;
      }
      if (response.status === 422 && errorBody.type === 'LIST_RECORDS_ITERATOR_NOT_AVAILABLE') {
        throw new AirtableIteratorExpiredError();
      }
      throw new AirtableApiError(
        errorBody.message || `Airtable API request failed with status ${response.status}`,
        response.status,
        errorBody.type
      );
    }
  }

  private async parseError(response: Response): Promise<{ type?: string; message?: string }> {
    try {
      const body = (await response.json()) as {
        error?: string | { type?: string; message?: string };
      };
      if (typeof body.error === 'string') {
        return { type: body.error };
      }
      return body.error ?? {};
    } catch {
      return {};
    }
  }
}
