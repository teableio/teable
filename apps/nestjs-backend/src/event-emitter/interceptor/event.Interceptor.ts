/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { EMIT_EVENT_NAME } from '../decorators/emit-controller-event.decorator';
import { EventEmitterService } from '../event-emitter.service';
import type { IEventContext } from '../interfaces/base-event.interface';
import { baseEventSchema, Events, spaceEventSchema } from '../model';

@Injectable()
export class EventMiddleware implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const emitEventName = this.reflector.get<Events>(EMIT_EVENT_NAME, context.getHandler());

    const eventContext: IEventContext = {
      user: req?.user,
      headers: req?.headers,
    };

    return next.handle().pipe(
      tap((data) => {
        const eventInstance = this.createInstance(emitEventName, {
          reqParams: req?.params,
          reqQuery: req?.query,
          reqBody: req?.body,
          data,
          eventContext,
        });

        const events = Array.isArray(eventInstance) ? eventInstance : [eventInstance];
        events.forEach((event) => {
          event && this.eventEmitterService.emitAsync(event.name, event);
        });
      })
    );
  }

  private createInstance(emitEventName: Events, plain: any) {
    switch (emitEventName) {
      /* base event plain to instance */
      case Events.BASE_CREATE:
      case Events.BASE_DELETE:
      case Events.BASE_UPDATE: {
        const { reqParams, data: base, eventContext: context } = plain;
        const { baseId } = reqParams || {};

        const baseEvent = baseEventSchema.safeParse({
          name: emitEventName,
          base,
          baseId,
          context,
        });
        return baseEvent.success ? baseEvent.data : undefined;
      }
      /* space event plain to instance */
      case Events.SPACE_CREATE:
      case Events.SPACE_DELETE:
      case Events.SPACE_UPDATE: {
        const { reqParams, data: space, eventContext: context } = plain;
        const { spaceId } = reqParams || {};

        const spaceEvent = spaceEventSchema.safeParse({
          name: emitEventName,
          space,
          spaceId,
          context,
        });
        return spaceEvent.success ? spaceEvent.data : undefined;
      }

      /* user event plain to instance */
      case Events.USER_SIGNIN:
        break;
      case Events.USER_SIGNUP:
        break;
      case Events.USER_SIGNOUT:
        break;
      case Events.USER_UPDATE:
        break;
      case Events.USER_DELETE:
        break;
      case Events.USER_PASSWORD_CHANGE:
        break;
    }
  }
}
