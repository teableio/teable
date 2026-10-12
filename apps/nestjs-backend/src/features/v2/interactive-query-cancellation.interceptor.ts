import {
  Injectable,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { catchError, defer, finalize, of, throwError, type Observable } from 'rxjs';
import type { IClsStore } from '../../types/cls';
import { findCancellation } from './v2-query-cancellation.middleware';

@Injectable()
export class InteractiveQueryCancellationInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    const controller = new AbortController();
    const { signal } = controller;
    this.cls.set('interactiveQueryAbort', signal);
    const store = this.cls.get();
    let disconnected = false;
    const onClose = () => {
      if (!response.writableFinished) {
        disconnected = true;
        controller.abort();
      }
    };
    response.on('close', onClose);
    if (response.destroyed || response.closed) onClose();

    return defer(() => next.handle()).pipe(
      catchError((error: unknown) => {
        if (signal.aborted && disconnected && findCancellation(error)) {
          // Nest awaits lastValueFrom: EMPTY would turn a clean disconnect into EmptyError.
          return of(undefined);
        }
        return throwError(() => error);
      }),
      finalize(() => {
        response.off('close', onClose);
        if (store.interactiveQueryAbort === signal) delete store.interactiveQueryAbort;
      })
    );
  }
}

export const InteractiveQueryCancellation = (): MethodDecorator =>
  UseInterceptors(InteractiveQueryCancellationInterceptor);
