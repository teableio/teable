/* eslint-disable @typescript-eslint/naming-convention */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { ClsService } from 'nestjs-cls';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { IClsStore } from '../types/cls';
import { applyTraceResponseHeaders } from './trace-response-headers';
import { USER_CONTEXT_SERVICE, IUserContextService } from './user-context.interface';

@Injectable()
export class RouteTracingInterceptor implements NestInterceptor {
  private readonly traceLinkBaseUrl?: string;

  constructor(
    @Optional() @Inject(ConfigService) configService?: ConfigService,
    @Optional() @Inject(ClsService) private readonly cls?: ClsService<IClsStore>,
    @Optional()
    @Inject(USER_CONTEXT_SERVICE)
    private readonly userContextService?: IUserContextService
  ) {
    this.traceLinkBaseUrl =
      configService?.get<string>('TRACE_LINK_BASE_URL') ?? process.env.TRACE_LINK_BASE_URL;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<void> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const span = trace.getActiveSpan();

    if (span) {
      const controllerClass = context.getClass();
      const handlerName = context.getHandler();
      const httpMethod = request.method;
      const url = request.url;
      const route = request.route?.path || this.extractRouteFromUrl(url);

      // User context from CLS (set by auth middleware)
      const userId = this.cls?.get('user.id');
      const origin = this.cls?.get('origin');
      const appId = this.cls?.get('appId');

      span.setAttributes({
        'http.method': httpMethod,
        'http.route': route,
        'http.target': url,
        'http.url': `${request.protocol}://${request.get('host')}${url}`,
        'nest.controller': controllerClass.name,
        'nest.handler': handlerName.name,
        'teable.route.full': `${httpMethod} ${route}`,
        'teable.route.controller': controllerClass.name,
        'teable.route.handler': handlerName.name,
        'teable.user.id': userId || 'anonymous',
        'teable.user.is_api': origin?.byApi || false,
        'teable.user.is_app': !!appId,
        'teable.app.id': appId || '',
      });

      const spanName = `${httpMethod} ${route}`;
      span.updateName(spanName);
      applyTraceResponseHeaders(response, this.traceLinkBaseUrl);
    }

    return next.handle().pipe(
      tap(() => {
        if (span) {
          span.setAttributes({
            'http.status_code': response.statusCode,
            responseStatusCode: response.statusCode.toString(),
          });

          // After handler execution, spaceId may be set by PermissionService
          this.setSpaceAttributes(span);
        }
      })
    );
  }

  private setSpaceAttributes(span: ReturnType<typeof trace.getActiveSpan>) {
    if (!span || !this.cls || !this.userContextService) return;

    const spaceId = this.cls.get('spaceId');
    if (!spaceId) return;

    span.setAttribute('teable.space.id', spaceId);

    // Resolve plan level asynchronously — fire-and-forget for the span
    this.userContextService.getPlanLevel(spaceId).then(
      (planLevel) => {
        span.setAttribute('teable.space.plan', planLevel);
      },
      () => {
        span.setAttribute('teable.space.plan', 'error');
      }
    );
  }

  private extractRouteFromUrl(url: string): string {
    return url
      .split('?')[0]
      .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '/:id')
      .replace(/\/[a-z0-9]{20,}/gi, '/:id')
      .replace(/\/\d+/g, '/:id')
      .replace(/\/rec[a-zA-Z0-9]+/g, '/:recordId')
      .replace(/\/tbl[a-zA-Z0-9]+/g, '/:tableId')
      .replace(/\/fld[a-zA-Z0-9]+/g, '/:fieldId')
      .replace(/\/vw[a-zA-Z0-9]+/g, '/:viewId')
      .replace(/\/bs[a-zA-Z0-9]+/g, '/:baseId')
      .replace(/\/spc[a-zA-Z0-9]+/g, '/:spaceId');
  }
}
