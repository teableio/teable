/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { SetMetadata, UseInterceptors } from '@nestjs/common';
import type { Event } from '@teable/core';
import { EventMiddleware } from '../interceptor/event.Interceptor';

type OrdinaryEventName = Extract<
  Event,
  | Event.BASE_CREATE
  | Event.BASE_DELETE
  | Event.BASE_UPDATE
  | Event.SPACE_CREATE
  | Event.SPACE_DELETE
  | Event.SPACE_UPDATE
>;

export const EMIT_EVENT_NAME = 'EMIT_EVENT_NAME';

export function EmitControllerEvent(name: OrdinaryEventName): MethodDecorator {
  return (target: any, key: string | symbol, descriptor: TypedPropertyDescriptor<any>) => {
    SetMetadata(EMIT_EVENT_NAME, name)(target, key, descriptor);
    UseInterceptors(EventMiddleware)(target, key, descriptor);
  };
}
