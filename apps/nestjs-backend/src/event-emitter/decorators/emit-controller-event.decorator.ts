/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { SetMetadata, UseInterceptors } from '@nestjs/common';
import { EventMiddleware } from '../interceptor/event.Interceptor';
import type { Events } from '../model';

type OrdinaryEventName = Extract<
  Events,
  | Events.BASE_CREATE
  | Events.BASE_DELETE
  | Events.BASE_UPDATE
  | Events.SPACE_CREATE
  | Events.SPACE_DELETE
  | Events.SPACE_UPDATE
>;

export const EMIT_EVENT_NAME = 'EMIT_EVENT_NAME';

export function EmitControllerEvent(name: OrdinaryEventName): MethodDecorator {
  return (target: any, key: string | symbol, descriptor: TypedPropertyDescriptor<any>) => {
    SetMetadata(EMIT_EVENT_NAME, name)(target, key, descriptor);
    UseInterceptors(EventMiddleware)(target, key, descriptor);
  };
}
