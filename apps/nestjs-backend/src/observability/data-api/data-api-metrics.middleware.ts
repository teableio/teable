import { performance } from 'node:perf_hooks';
import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type {
  DataApiImplementation,
  DataApiOperation,
  DataApiOutcome,
} from './data-api-metrics.service';
import { DataApiMetricsService } from './data-api-metrics.service';

// Explicit public record routes shared by community and EE, including v1/v2.
// Inspect only the path for classification; never export it or query/body data.
// The rec prefix prevents /history, /collaborators, etc. becoming record reads.
const recordRoute = /^\/api\/table\/[^/]+\/record(?:\/(rec[a-z0-9]+)(?:\/(duplicate))?)?\/?$/i;
const formRoute = /^\/api\/table\/[^/]+\/record\/form-submit\/?$/i;
const collectionOperations = new Map<string, DataApiOperation>([
  ['GET', 'list'],
  ['POST', 'create'],
  ['PATCH', 'update_many'],
  ['DELETE', 'delete_many'],
]);
const recordOperations = new Map<string, DataApiOperation>([
  ['GET', 'get'],
  ['PATCH', 'update'],
  ['DELETE', 'delete'],
]);

const getOperation = (method: string, path: string): DataApiOperation | undefined => {
  if (method === 'POST' && formRoute.test(path)) return 'form_submit';
  const match = recordRoute.exec(path);
  if (!match) return;
  const [, recordId, duplicate] = match;
  if (duplicate) return method === 'POST' ? 'duplicate' : undefined;
  return (recordId ? recordOperations : collectionOperations).get(method);
};

/**
 * 304 is a legitimate conditional-GET result on the GET list/get routes: Express builds the
 * whole body and its ETag before it decides freshness, so the read was served and must not
 * count as a failure. The other 3xx contradict the record API contract — no route below
 * /api/table/:tableId/record redirects and none carries @EnsureLogin — so they stay in the
 * failure-counted `unexpected` bucket rather than silently leaving the SLO failure set.
 */
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const getOutcome = (status: number, aborted: boolean): DataApiOutcome => {
  if (aborted || status === 499) return 'aborted';
  if (status === 304) return 'not_modified';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 500) return 'server_error';
  if (status === 429) return 'throttled';
  if (status >= 400) return 'client_error';
  return 'unexpected';
};

type OffContractReason = 'informational' | 'redirect' | 'unknown_status';

const getOffContractReason = (status: number): OffContractReason => {
  if (status >= 100 && status < 200) return 'informational';
  return redirectStatuses.has(status) ? 'redirect' : 'unknown_status';
};

// Statuses are server-generated, so this dimension stays tiny; the bound is only there so a
// misbehaving writer cannot mint unbounded metric series from `unexpected`.
const isBoundedStatus = (status: number): boolean =>
  Number.isInteger(status) && status >= 100 && status <= 599;

const offContractLogWindowMs = 60_000;
const offContractLogKeyCap = 256;

/** One warning per key per window; what it swallowed is reported on the next line. */
class OffContractLogThrottle {
  private readonly entries = new Map<string, { lastLoggedAt: number; suppressed: number }>();

  /** `undefined` while the key is inside its window: the event was counted, not logged. */
  suppressedSinceLast(key: string, now: number): number | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= offContractLogKeyCap) {
        const oldest = this.entries.keys().next();
        if (!oldest.done) this.entries.delete(oldest.value);
      }
      this.entries.set(key, { lastLoggedAt: now, suppressed: 0 });
      return 0;
    }
    if (now - entry.lastLoggedAt < offContractLogWindowMs) {
      entry.suppressed += 1;
      return;
    }
    const suppressed = entry.suppressed;
    entry.suppressed = 0;
    entry.lastLoggedAt = now;
    return suppressed;
  }
}

@Injectable()
export class DataApiMetricsMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DataApiMetricsMiddleware.name);
  private readonly offContractLog = new OffContractLogThrottle();
  // Exclude evidence writes and synthetic probes from user-facing SLI denominators.
  // This is a trusted server-side table allowlist, never a client-supplied header.
  private readonly observerTables = new Set(
    (process.env.DATA_API_OBSERVER_TABLE_IDS ?? '')
      .split(',')
      .map((tableId) => tableId.trim())
      .filter(Boolean)
  );

  constructor(private readonly metrics: DataApiMetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const path = request.originalUrl.split('?')[0];
    const operation = getOperation(request.method, path);
    if (!operation || this.observerTables.has(path.split('/')[3])) return next();

    const start = performance.now();
    try {
      this.metrics.recordStart(operation);
    } catch {
      // Observability must not reject a data operation, even with a broken provider.
      return next();
    }

    let ended = false;
    const end = (aborted: boolean) => {
      if (ended) return;
      ended = true;
      response.off('finish', onFinish);
      response.off('close', onClose);
      try {
        // Use the final server response attribution, including a v2 -> v1 fallback.
        // Missing attribution (e.g. a guard rejection) must not be guessed as v1.
        const v2 = response.getHeader('x-teable-v2');
        const implementation = v2 === 'true' ? 'v2' : v2 === 'false' ? 'v1' : 'unknown';
        const status = response.statusCode;
        const outcome = getOutcome(status, aborted);
        this.metrics.recordEnd(
          operation,
          implementation,
          outcome,
          Math.max(0, performance.now() - start)
        );
        // A 304 is a served read, so only a status no outcome explains is worth a line.
        if (outcome === 'unexpected') {
          this.reportOffContract(operation, implementation, status);
        }
      } catch {
        // A metric failure must not escape a response event handler.
      }
    };
    const onFinish = () => end(false);
    const onClose = () => end(!response.writableFinished);
    response.once('finish', onFinish);
    response.once('close', onClose);
    next();
  }

  /**
   * Locates an off-contract response without turning telemetry into an identifier: only a
   * bounded status and an enum reason leave the process, and identical repeats collapse
   * into one line per window. The trace correlation comes from the log context, not a tag.
   */
  private reportOffContract(
    operation: DataApiOperation,
    implementation: DataApiImplementation,
    status: number
  ): void {
    const reason = getOffContractReason(status);
    this.metrics.recordOffContract(
      operation,
      implementation,
      isBoundedStatus(status) ? String(status) : 'other'
    );
    const suppressed = this.offContractLog.suppressedSinceLast(
      `${operation}|${implementation}|${status}|${reason}`,
      Date.now()
    );
    if (suppressed === undefined) return;
    this.logger.warn(
      `Data API response the contract does not explain: outcome=unexpected operation=${operation} implementation=${implementation} http_status=${status} reason=${reason} suppressed_since_last_log=${suppressed}`
    );
  }
}
