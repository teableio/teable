import { performance } from 'node:perf_hooks';
import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { DataApiOperation, DataApiOutcome } from './data-api-metrics.service';
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

const getOutcome = (status: number, aborted: boolean): DataApiOutcome => {
  if (aborted || status === 499) return 'aborted';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 500) return 'server_error';
  if (status === 429) return 'throttled';
  if (status >= 400) return 'client_error';
  return 'unexpected';
};

@Injectable()
export class DataApiMetricsMiddleware implements NestMiddleware {
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
        this.metrics.recordEnd(
          operation,
          implementation,
          getOutcome(response.statusCode, aborted),
          Math.max(0, performance.now() - start)
        );
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
}
