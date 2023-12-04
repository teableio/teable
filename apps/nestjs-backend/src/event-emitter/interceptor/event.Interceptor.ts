/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { EMIT_EVENT_NAME } from '../decorators/emit-event.decorator';
import { EventEmitterService } from '../event-emitter.service';
import type { IEventContext } from '../interfaces/base-event.interface';
import { BaseCreateEvent, BaseDeleteEvent, BaseUpdateEvent, Events } from '../model';
import { SpaceCreateEvent, SpaceDeleteEvent, SpaceUpdateEvent } from '../model/space/space-event';

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
          event && this.eventEmitterService.emit(event.name, event);
        });
      })
      // map((data) => {
      //   return data;
      // })
    );
  }

  private createInstance(emitEventName: Events, plain: any) {
    switch (emitEventName) {
      /* base event plain to instance */
      case Events.BASE_CREATE: {
        const { data: base, eventContext: context } = plain;
        return plainToInstance(BaseCreateEvent, { base, context });
      }
      case Events.BASE_DELETE: {
        const { data: baseId, eventContext: context } = plain;
        return plainToInstance(BaseDeleteEvent, { baseId, context });
      }
      case Events.BASE_UPDATE: {
        const { reqParams, data: base, eventContext: context } = plain;
        const { baseId } = reqParams;
        return plainToInstance(BaseUpdateEvent, { baseId, base, context });
      }
      /* space event plain to instance */
      case Events.SPACE_CREATE: {
        const { data: space, eventContext: context } = plain;
        return plainToInstance(SpaceCreateEvent, { space, context });
      }
      case Events.SPACE_DELETE: {
        const { reqParams, eventContext: context } = plain;
        const { spaceId } = reqParams;

        return plainToInstance(SpaceDeleteEvent, { spaceId, context });
      }
      case Events.SPACE_UPDATE: {
        const { reqParams, data: space, eventContext: context } = plain;
        const { spaceId } = reqParams;
        return plainToInstance(SpaceUpdateEvent, { spaceId, space, context });
      }

      // case Events.SHARED_VIEW_CREATE:
      //   break;
      // case Events.SHARED_VIEW_DELETE:
      //   break;
      // case Events.SHARED_VIEW_UPDATE:
      //   break;

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
