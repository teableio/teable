import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { parser } from 'stream-json';
import Assembler from 'stream-json/Assembler';
import { ignore } from 'stream-json/filters/Ignore';

/**
 * Reads Airtable view configuration (filters/sorts/groups/kanban stacking) that
 * the official Web API does not expose, through the same undocumented endpoint
 * behind a public shared-base link that Baserow and NocoDB use. It is read-only,
 * authenticated solely by the signed access policy embedded in the share page,
 * and used as an opt-in enhancement that always degrades gracefully.
 */
const shareBaseUrl = 'https://airtable.com';
const shareApiBaseUrl = 'https://airtable.com/v0.3';
const browserUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// Polite spacing between sequential reads of the undocumented private endpoint.
const minRequestIntervalMs = 200;
const sessionNotResolvedMessage = 'Share session not resolved.';

export type IAirtableShareErrorReason =
  | 'not_public'
  | 'not_a_base'
  | 'requires_auth'
  | 'base_mismatch'
  | 'resolve_failed';

export class AirtableShareError extends Error {
  constructor(
    message: string,
    public readonly reason: IAirtableShareErrorReason
  ) {
    super(message);
    this.name = 'AirtableShareError';
  }
}

/** Opaque, time-boxed session scraped from the share page; replayed verbatim. */
export interface IAirtableShareSession {
  appId: string;
  accessPolicy: string;
  requestId: string;
  pageLoadId: string;
  codeVersion: string;
  cookie: string;
}

export interface IAirtableFilterLeaf {
  columnId: string;
  operator: string;
  value: unknown;
}

export interface IAirtableFilterGroup {
  conjunction: 'and' | 'or';
  filterSet: Array<IAirtableFilterLeaf | IAirtableFilterGroup>;
}

export interface IAirtableSort {
  columnId: string;
  ascending: boolean;
}

export interface IAirtableGroupLevel {
  columnId: string;
  order: 'ascending' | 'descending';
}

export interface IAirtableViewConfig {
  filters: IAirtableFilterGroup | null;
  sorts: IAirtableSort[] | null;
  groupLevels: IAirtableGroupLevel[] | null;
  metadata: Record<string, unknown> | undefined;
}

/** A rollup column's source, read from the base model the official API does not expose. */
export interface IAirtableRollupSource {
  /** Airtable link field the rollup summarizes through. */
  relationColumnId: string;
  /** Airtable field, in the linked table, being rolled up. */
  foreignTableRollupColumnId: string;
  /** Aggregation formula, e.g. "SUM(values)". */
  aggregation: string;
  /** Optional "only include linked records that meet conditions" filter. */
  filter: IAirtableFilterGroup | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Locates a rollup's record-selection filter inside its typeOptions by shape
 * (an object carrying a `filterSet`), so it is found regardless of the exact key.
 */
const findAirtableFilter = (typeOptions: Record<string, unknown>): IAirtableFilterGroup | null => {
  for (const value of Object.values(typeOptions)) {
    if (
      value &&
      typeof value === 'object' &&
      Array.isArray((value as { filterSet?: unknown }).filterSet)
    ) {
      return value as IAirtableFilterGroup;
    }
  }
  return null;
};

export class AirtableShareClient {
  private lastRequestAt = 0;
  private session?: IAirtableShareSession;

  /** appId carried by a canonical share URL, for a cheap client-side pre-check. */
  static parseBaseIdFromLink(shareLink: string): string | undefined {
    return shareLink.match(/app[A-Za-z0-9]+/)?.[0];
  }

  /**
   * Resolves a public shared-base link into a session by scraping the share
   * page. Throws AirtableShareError with a typed reason on every failure mode.
   */
  async resolveShare(shareLink: string): Promise<IAirtableShareSession> {
    const { html, cookie } = await this.fetchSharePage(this.buildShareUrl(shareLink));
    const session = this.parseShareSession(html, cookie);
    this.session = session;
    return session;
  }

  private async fetchSharePage(shareUrl: string): Promise<{ html: string; cookie: string }> {
    let response: Response;
    try {
      response = await fetch(shareUrl, {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name
        headers: { 'User-Agent': browserUserAgent, Accept: 'text/html' },
        redirect: 'manual',
      });
    } catch (e) {
      throw new AirtableShareError(
        `Failed to reach Airtable: ${e instanceof Error ? e.message : 'network error'}`,
        'resolve_failed'
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') ?? '';
      if (location.startsWith('/login')) {
        throw new AirtableShareError(
          'The shared base is not public; turn on the public shared-base link in Airtable.',
          'requires_auth'
        );
      }
      throw new AirtableShareError('The share link is not publicly accessible.', 'not_public');
    }
    if (!response.ok) {
      throw new AirtableShareError(
        `The share link is not accessible (status ${response.status}).`,
        'not_public'
      );
    }
    const cookie = (response.headers.getSetCookie?.() ?? [])
      .map((entry) => entry.split(';')[0])
      .join('; ');
    return { html: await response.text(), cookie };
  }

  private parseShareSession(html: string, cookie: string): IAirtableShareSession {
    const requestId = html.match(/requestId: "(.*?)",/)?.[1];
    const initRaw = html.match(/window\.initData = (.*?);\n/)?.[1];
    if (!requestId || !initRaw) {
      throw new AirtableShareError(
        'The link does not look like an Airtable shared base.',
        'not_a_base'
      );
    }
    let initData: {
      sharedApplicationId?: string;
      accessPolicy?: unknown;
      pageLoadId?: string;
      codeVersion?: string;
    };
    try {
      initData = JSON.parse(initRaw);
    } catch {
      throw new AirtableShareError('Failed to read the shared base metadata.', 'resolve_failed');
    }
    const appId = initData.sharedApplicationId;
    if (!appId || typeof initData.accessPolicy !== 'string') {
      throw new AirtableShareError(
        'The link is a shared view, not a shared base. Share the whole base instead.',
        'not_a_base'
      );
    }
    return {
      appId,
      accessPolicy: initData.accessPolicy,
      requestId,
      pageLoadId: initData.pageLoadId ?? '',
      codeVersion: initData.codeVersion ?? '',
      cookie,
    };
  }

  /** Asserts the resolved share points at the base the import is creating. */
  assertBaseMatch(expectedBaseId: string): void {
    if (!this.session) {
      throw new AirtableShareError(sessionNotResolvedMessage, 'resolve_failed');
    }
    if (this.session.appId !== expectedBaseId) {
      throw new AirtableShareError(
        `The share link points at a different base (${this.session.appId}) than the one being imported (${expectedBaseId}).`,
        'base_mismatch'
      );
    }
  }

  /**
   * Reads one view's configuration. The response also carries the view's full
   * row ordering; those branches are dropped at the token level so memory stays
   * flat regardless of how many records the view holds.
   */
  async fetchViewConfig(viewId: string): Promise<IAirtableViewConfig> {
    const session = this.session;
    if (!session) {
      throw new AirtableShareError(sessionNotResolvedMessage, 'resolve_failed');
    }
    await this.throttle();

    const params = new URLSearchParams({
      stringifiedObjectParams: JSON.stringify({
        mayOnlyIncludeRowAndCellDataForIncludedViews: true,
        mayExcludeCellDataForLargeViews: true,
        allowMsgpackOfResult: false,
      }),
      requestId: session.requestId,
      accessPolicy: session.accessPolicy,
    });
    const response = await fetch(
      `${shareApiBaseUrl}/view/${encodeURIComponent(viewId)}/readData?${params.toString()}`,
      { headers: this.apiHeaders(session) }
    );
    if (!response.ok || !response.body) {
      throw new AirtableShareError(
        `Failed to read view ${viewId} (status ${response.status}).`,
        'resolve_failed'
      );
    }

    const root = await this.assembleJson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Readable.fromWeb(response.body as any),
      /(?:^|\.)(rowOrder|signedUserContentUrls)(?:\.|$)/
    );
    const data = (root?.data ?? {}) as {
      filters?: IAirtableFilterGroup;
      lastSortsApplied?: { sortSet?: IAirtableSort[] };
      groupLevels?: IAirtableGroupLevel[];
      metadata?: Record<string, unknown>;
    };
    return {
      filters: data.filters ?? null,
      sorts: data.lastSortsApplied?.sortSet ?? null,
      groupLevels: data.groupLevels ?? null,
      metadata: data.metadata,
    };
  }

  /**
   * Reads the whole base model — which the official API never exposes enough of
   * to recreate rollups — and returns each rollup's link/foreign field,
   * aggregation, and optional filter. The model also embeds every record
   * (`tableDatas`); that branch is dropped at the token level so memory stays
   * flat regardless of base size.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- flat schema walk
  async fetchApplicationModel(): Promise<Map<string, IAirtableRollupSource>> {
    const session = this.session;
    if (!session) {
      throw new AirtableShareError(sessionNotResolvedMessage, 'resolve_failed');
    }
    await this.throttle();

    const params = new URLSearchParams({
      stringifiedObjectParams: JSON.stringify({}),
      requestId: session.requestId,
      accessPolicy: session.accessPolicy,
    });
    const response = await fetch(
      `${shareApiBaseUrl}/application/${encodeURIComponent(session.appId)}/read?${params.toString()}`,
      { headers: this.apiHeaders(session) }
    );
    if (!response.ok || !response.body) {
      throw new AirtableShareError(
        `Failed to read the base model (status ${response.status}).`,
        'resolve_failed'
      );
    }

    const root = await this.assembleJson(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Readable.fromWeb(response.body as any),
      /(?:^|\.)(tableDatas)(?:\.|$)/
    );
    const tableSchemas = ((root?.data as { tableSchemas?: unknown })?.tableSchemas ?? []) as Array<{
      columns?: Array<{ id?: string; type?: string; typeOptions?: Record<string, unknown> }>;
    }>;

    const rollups = new Map<string, IAirtableRollupSource>();
    for (const table of tableSchemas) {
      for (const column of table.columns ?? []) {
        if (column.type !== 'rollup' || !column.id || !column.typeOptions) continue;
        const { relationColumnId, foreignTableRollupColumnId, formulaTextParsed } =
          column.typeOptions;
        if (
          typeof relationColumnId !== 'string' ||
          typeof foreignTableRollupColumnId !== 'string' ||
          typeof formulaTextParsed !== 'string'
        ) {
          continue;
        }
        rollups.set(column.id, {
          relationColumnId,
          foreignTableRollupColumnId,
          aggregation: formulaTextParsed,
          filter: findAirtableFilter(column.typeOptions),
        });
      }
    }
    return rollups;
  }

  /** Assembles the JSON value while dropping the matched (large) payload branches. */
  private async assembleJson(
    stream: Readable,
    ignoreBranches: RegExp
  ): Promise<Record<string, unknown>> {
    const tokens = stream.pipe(parser()).pipe(ignore({ filter: ignoreBranches }));
    const assembler = Assembler.connectTo(tokens);
    await finished(tokens);
    return (assembler.current ?? {}) as Record<string, unknown>;
  }

  /**
   * Builds the canonical `airtable.com/{appId}/{shrId}` URL. The share id alone
   * (without the app prefix) 404s; the prefixed form is what Airtable's own
   * "Copy link" produces and what other importers request.
   */
  private buildShareUrl(shareLink: string): string {
    const shareId = shareLink.match(/shr[A-Za-z0-9]+/)?.[0];
    if (!shareId) {
      throw new AirtableShareError(
        'Enter a valid Airtable shared-base link (https://airtable.com/.../shr...).',
        'not_a_base'
      );
    }
    const appId = shareLink.match(/app[A-Za-z0-9]+/)?.[0];
    return appId ? `${shareBaseUrl}/${appId}/${shareId}` : `${shareBaseUrl}/${shareId}`;
  }

  private apiHeaders(session: IAirtableShareSession): Record<string, string> {
    /* eslint-disable @typescript-eslint/naming-convention -- HTTP header names */
    return {
      'User-Agent': browserUserAgent,
      Accept: 'application/json',
      'x-airtable-application-id': session.appId,
      'x-airtable-inter-service-client': 'webClient',
      'x-airtable-inter-service-client-code-version': session.codeVersion,
      'x-airtable-page-load-id': session.pageLoadId,
      'X-Requested-With': 'XMLHttpRequest',
      'x-time-zone': 'UTC',
      'x-user-locale': 'en',
      cookie: session.cookie,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + minRequestIntervalMs - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastRequestAt = Date.now();
  }
}
