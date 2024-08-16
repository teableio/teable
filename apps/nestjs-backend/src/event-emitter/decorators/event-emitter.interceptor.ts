import type { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { EventEmitterService } from '../event-emitter.service';

@Injectable()
export class EventEmitterInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private eventEmitterService: EventEmitterService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const eventMetadata = this.reflector.get<{ eventName: string; paramNames?: string[] }>(
      'eventMetadata',
      context.getHandler()
    );

    if (!eventMetadata) {
      return next.handle();
    }

    const { eventName, paramNames } = eventMetadata;
    const req = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap((result) => {
        const payload: { result: unknown; params: Record<string, unknown>; windowId?: string } = {
          result,
          params: {},
        };

        const windowId = req.headers['x-window-id'];
        if (windowId) {
          payload.windowId = windowId;
        }

        if (paramNames && paramNames.length > 0) {
          paramNames.forEach((paramName) => {
            if (req.params && paramName in req.params) {
              payload.params[paramName] = req.params[paramName];
            } else if (req.body && paramName in req.body) {
              payload.params[paramName] = req.body[paramName];
            } else if (req.query && paramName in req.query) {
              payload.params[paramName] = req.query[paramName];
            }
          });
        } else {
          // If no specific param names are provided, include all available params
          payload.params = {
            ...req.params,
            ...req.query,
            ...req.body,
          };
        }

        this.eventEmitterService.emitAsync(eventName, payload);
      })
    );
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const EmitEvent = (eventName: string, paramNames?: string[]) =>
  SetMetadata('eventMetadata', { eventName, paramNames });
