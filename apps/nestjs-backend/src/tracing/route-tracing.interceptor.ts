/* eslint-disable @typescript-eslint/naming-convention */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class RouteTracingInterceptor implements NestInterceptor {
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
      });

      const spanName = `${httpMethod} ${route}`;
      span.updateName(spanName);
    }

    return next.handle().pipe(
      tap(() => {
        if (span) {
          span.setAttributes({
            'http.status_code': response.statusCode,
            responseStatusCode: response.statusCode.toString(),
          });
        }
      })
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
