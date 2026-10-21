/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { SetMetadata, UseInterceptors } from '@nestjs/common';
import type { Events } from '../events';
import { EventMiddleware } from '../interceptor/event.Interceptor';

export const EMIT_EVENT_NAME = 'EMIT_EVENT_NAME';
export const SKIP_EVENT_WHEN_V2 = 'SKIP_EVENT_WHEN_V2';

export function EmitControllerEvent(
  name: Events,
  options?: { skipWhenV2?: boolean }
): MethodDecorator {
  return (target: any, key: string | symbol, descriptor: TypedPropertyDescriptor<any>) => {
    SetMetadata(EMIT_EVENT_NAME, name)(target, key, descriptor);
    SetMetadata(SKIP_EVENT_WHEN_V2, options?.skipWhenV2 === true)(target, key, descriptor);
    UseInterceptors(EventMiddleware)(target, key, descriptor);
  };
}
