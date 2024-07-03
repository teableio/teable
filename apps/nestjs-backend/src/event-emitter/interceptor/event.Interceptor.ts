/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Event } from '@teable/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { match, P } from 'ts-pattern';
import { EMIT_EVENT_NAME } from '../decorators/emit-controller-event.decorator';
import { EventEmitterService } from '../event-emitter.service';
import type { IEventContext } from '../events';
import { BaseEventFactory, SpaceEventFactory } from '../events';

@Injectable()
export class EventMiddleware implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const emitEventName = this.reflector.get<Event>(EMIT_EVENT_NAME, context.getHandler());

    return next.handle().pipe(
      tap((data) => {
        const interceptContext = this.interceptContext(req, data);

        const event = this.createEvent(emitEventName, interceptContext);
        event && this.eventEmitterService.emitAsync(event.name, event);
      })
    );
  }

  private interceptContext(req: Request, resolveData: any) {
    return {
      reqUser: req?.user as any,
      reqHeaders: req?.headers,
      reqParams: req?.params,
      reqQuery: req?.query,
      reqBody: req?.body,
      resolveData,
    };
  }

  private createEvent(
    eventName: Event,
    interceptContext: ReturnType<typeof this.interceptContext>
  ) {
    const { reqUser, reqHeaders, reqParams, resolveData } = interceptContext;

    const eventContext: IEventContext = {
      user: reqUser,
      headers: reqHeaders,
    };

    return match(eventName)
      .with(P.union(Event.BASE_CREATE, Event.BASE_DELETE, Event.BASE_UPDATE), () =>
        BaseEventFactory.create(eventName, { base: resolveData, ...reqParams }, eventContext)
      )
      .with(P.union(Event.SPACE_CREATE, Event.SPACE_DELETE, Event.SPACE_UPDATE), () =>
        SpaceEventFactory.create(eventName, { space: resolveData, ...reqParams }, eventContext)
      )
      .otherwise(() => null);
  }
}
