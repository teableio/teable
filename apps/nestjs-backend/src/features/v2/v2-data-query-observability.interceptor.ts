import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { applyDecorators, Injectable, SetMetadata, UseInterceptors } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { metrics, trace } from '@opentelemetry/api';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { defer, finalize, tap } from 'rxjs';
import type { IClsStore } from '../../types/cls';

const operationMetadata = 'teable.data_query.operation';
type DataQueryOperation = 'execute' | 'validate' | 'explain';
type DataQueryOutcome = 'success' | 'error' | 'cancelled';
const sources: Record<string, true> = {
  mcp: true,
  cuppy_chat: true,
  cuppyclaw: true,
  cli: true,
  app: true,
  automation: true,
};
const correlationHeaders = [
  ['x-teable-chat-id', 'teable.chat.id'],
  ['x-teable-generation-id', 'teable.generation.id'],
  ['x-teable-tool-call-id', 'teable.tool_call.id'],
  ['x-teable-chat-message-id', 'teable.chat_message.id'],
] as const;

/** Node may join repeated headers, so inspect raw occurrences as well as parsed values. */
const singleHeader = (request: Request, name: string): string | undefined => {
  const value = request.headers[name];
  if (typeof value !== 'string') return undefined;
  let occurrences = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i].toLowerCase() === name && ++occurrences > 1) return undefined;
  }
  return value;
};

@Injectable()
export class V2DataQueryObservabilityInterceptor implements NestInterceptor {
  private readonly meter = metrics.getMeter('teable-observability');
  private readonly requests = this.meter.createCounter('teable.data_query.requests.total', {
    description: 'Authenticated native query controller invocations by terminal outcome',
  });
  private readonly duration = this.meter.createHistogram('teable.data_query.duration.ms', {
    description: 'Native query controller duration through success, error or cancellation',
    unit: 'ms',
  });

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<IClsStore>
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const operation = this.reflector.get<DataQueryOperation>(
      operationMetadata,
      context.getHandler()
    );
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const suppliedSource = singleHeader(request, 'x-teable-query-source');
    // appId is established by authentication; source headers never grant authority.
    const source = this.cls.get('appId')
      ? 'app'
      : suppliedSource && Object.hasOwn(sources, suppliedSource)
        ? suppliedSource
        : 'unknown';
    const span = trace.getActiveSpan();
    span?.setAttribute('teable.data_query.source', source);
    span?.setAttribute('teable.data_query.operation', operation);
    for (const [header, attribute] of correlationHeaders) {
      const id = singleHeader(request, header);
      if (id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
        span?.setAttribute(attribute, id);
      }
    }

    return defer(() => {
      const started = performance.now();
      let ended = false;
      let canonicalSuccess = false;
      const record = (outcome: DataQueryOutcome) => {
        if (ended) return;
        ended = true;
        response.removeListener('close', onClose);
        const attributes = {
          'teable.data_query.source': source,
          'teable.data_query.operation': operation,
          'teable.data_query.outcome': outcome,
        };
        this.requests.add(1, attributes);
        this.duration.record(performance.now() - started, attributes);
        span?.setAttribute('teable.data_query.outcome', outcome);
      };
      const onClose = () => {
        if (!response.writableFinished) record('cancelled');
      };
      response.once('close', onClose);
      // The response may have closed while guards were still awaiting authentication.
      if (response.destroyed) onClose();
      // defer also captures synchronous throws from the next interceptor/handler.
      return defer(() => next.handle()).pipe(
        tap({
          next: (body: unknown) => {
            canonicalSuccess =
              typeof body === 'object' && body !== null && 'ok' in body && body.ok === true;
          },
          error: () => record('error'),
          complete: () =>
            record(canonicalSuccess && response.statusCode < 400 ? 'success' : 'error'),
        }),
        finalize(() => record('cancelled'))
      );
    });
  }
}

/** Runs after guards, counting accepted controller invocations rather than raw HTTP attempts. */
export const ObserveDataQuery = (operation: DataQueryOperation) =>
  applyDecorators(
    SetMetadata(operationMetadata, operation),
    UseInterceptors(V2DataQueryObservabilityInterceptor)
  );
