import 'reflect-metadata';

import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import {
  Body,
  Controller,
  Get,
  Post,
  type ArgumentsHost,
  type INestApplication,
} from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test } from '@nestjs/testing';
import { PostgresQueryCancelledError } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId, MemoryQueryBus } from '@teable/v2-core';
import type { Response } from 'express';
import { ClsModule, ClsService } from 'nestjs-cls';
import { defer, lastValueFrom, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { IClsStore } from '../../types/cls';
import {
  InteractiveQueryCancellation,
  InteractiveQueryCancellationInterceptor,
} from './interactive-query-cancellation.interceptor';
import { throwV2Error } from './v2-http-error';
import { V2QueryCancellationMiddleware } from './v2-query-cancellation.middleware';

const createFixture = () => {
  const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    destroyed: false,
    closed: false,
  });
  return {
    cls,
    req,
    res,
    interceptor: new InteractiveQueryCancellationInterceptor(cls),
    context: new ExecutionContextHost([req, res]),
  };
};

describe('InteractiveQueryCancellationInterceptor lifecycle', () => {
  it('ignores request body completion and normal response close', async () => {
    const { cls, req, res, interceptor, context } = createFixture();
    await cls.run(async () => {
      const source = new Subject<string>();
      const result = lastValueFrom(interceptor.intercept(context, { handle: () => source }));
      const signal = cls.get('interactiveQueryAbort')!;
      req.emit('end');
      req.emit('close');
      res.writableFinished = true;
      res.emit('close');
      expect(signal.aborted).toBe(false);
      source.next('records');
      source.complete();
      expect(await result).toBe('records');
      expect(cls.get('interactiveQueryAbort')).toBeUndefined();
      expect(res.listenerCount('close')).toBe(0);
      res.writableFinished = false;
      res.emit('close');
      expect(signal.aborted).toBe(false);
    });
  });

  it('aborts a disconnected response and completes with a value for Nest lastValueFrom', async () => {
    const { cls, res, interceptor, context } = createFixture();
    await cls.run(async () => {
      const source = new Subject();
      const result = lastValueFrom(interceptor.intercept(context, { handle: () => source }));
      const signal = cls.get('interactiveQueryAbort')!;
      res.emit('close');
      expect(signal.aborted).toBe(true);
      source.error(new PostgresQueryCancelledError());
      await expect(result).resolves.toBeUndefined();
      expect(cls.get('interactiveQueryAbort')).toBeUndefined();
      expect(res.listenerCount('close')).toBe(0);
    });
  });

  it('marks a previously destroyed response before invoking the handler', async () => {
    const { cls, res, interceptor, context } = createFixture();
    res.destroyed = true;
    await cls.run(async () => {
      const result = interceptor.intercept(context, {
        handle: () =>
          defer(() => {
            expect(cls.get('interactiveQueryAbort')?.aborted).toBe(true);
            throw new PostgresQueryCancelledError();
          }),
      });
      await expect(lastValueFrom(result)).resolves.toBeUndefined();
    });
  });

  it('does not erase a replacement signal when the earlier observable is unsubscribed', () => {
    const { cls, res, interceptor, context } = createFixture();
    cls.run(() => {
      const source = new Subject();
      const subscription = interceptor.intercept(context, { handle: () => source }).subscribe();
      const replacement = new AbortController().signal;
      cls.set('interactiveQueryAbort', replacement);
      subscription.unsubscribe();
      expect(cls.get('interactiveQueryAbort')).toBe(replacement);
      expect(res.listenerCount('close')).toBe(0);
    });
  });

  it('propagates dedicated cancellation while connected and real SQL errors after disconnect', async () => {
    const { cls, res, interceptor, context } = createFixture();
    await cls.run(async () => {
      const cancellation = new PostgresQueryCancelledError();
      await expect(
        lastValueFrom(
          interceptor.intercept(context, {
            handle: () => throwError(() => cancellation),
          })
        )
      ).rejects.toBe(cancellation);
      const timeout = Object.assign(new Error('statement timeout'), { code: '57014' });
      const source = new Subject();
      const result = lastValueFrom(interceptor.intercept(context, { handle: () => source }));
      res.emit('close');
      source.error(timeout);
      await expect(result).rejects.toBe(timeout);
    });
  });
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

@Controller('interactive-cancellation')
class CancellationTestController {
  started = deferred();
  cancelled = deferred();

  constructor(private readonly cls: ClsService<IClsStore>) {}

  @Get()
  @InteractiveQueryCancellation()
  async getRecords() {
    await setImmediate();
    return { records: ['record'], aborted: this.cls.get('interactiveQueryAbort')?.aborted };
  }

  @Post()
  @InteractiveQueryCancellation()
  async postRecords(@Body() body: unknown) {
    await setImmediate();
    return { body, aborted: this.cls.get('interactiveQueryAbort')?.aborted };
  }

  @Get('pending')
  @InteractiveQueryCancellation()
  async pending() {
    const signal = this.cls.get('interactiveQueryAbort')!;
    this.started.resolve();
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true })
    );
    this.cancelled.resolve();
    this.cls.set('useV2', true);
    const bus = new MemoryQueryBus(
      {
        resolve: () => {
          throw new Error('cancelled handler ran');
        },
      },
      [new V2QueryCancellationMiddleware(this.cls)]
    );
    const result = await bus.execute({ actorId: ActorId.create('system')._unsafeUnwrap() }, {});
    if (result.isErr()) throwV2Error(result.error, 500);
    return result.value;
  }

  @Get('sql-error')
  @InteractiveQueryCancellation()
  sqlError() {
    throw Object.assign(new Error('statement timeout'), { code: '57014' });
  }
}

describe('InteractiveQueryCancellationInterceptor through Nest HTTP', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
  });

  const startApp = async () => {
    const module = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
      controllers: [CancellationTestController],
      providers: [InteractiveQueryCancellationInterceptor],
    }).compile();
    app = module.createNestApplication();
    const errors: unknown[] = [];
    app.useGlobalFilters({
      catch(error: unknown, host: ArgumentsHost) {
        errors.push(error);
        const response = host.switchToHttp().getResponse<Response>();
        if (!response.destroyed) response.status(500).json({ error: 'sql-error' });
      },
    });
    await app.listen(0, '127.0.0.1');
    return {
      url: `${await app.getUrl()}/interactive-cancellation`,
      errors,
      controller: module.get(CancellationTestController),
    };
  };

  it('serves real GET and completed POST bodies without cancelling their responses', async () => {
    const { url, errors } = await startApp();
    const getResponse = await fetch(url);
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({ records: ['record'], aborted: false });
    const postResponse = await fetch(url, {
      method: 'POST',
      headers: [['content-type', 'application/json']],
      body: JSON.stringify({ ids: ['record'] }),
    });
    expect(postResponse.status).toBe(201);
    expect(await postResponse.json()).toEqual({ body: { ids: ['record'] }, aborted: false });
    expect(errors).toEqual([]);
  });

  it('does not send a cancellation or EmptyError through the Nest exception filter on socket close', async () => {
    const { url, errors, controller } = await startApp();
    const client = request(`${url}/pending`);
    client.on('error', () => undefined);
    client.end();
    try {
      await controller.started.promise;
      client.destroy();
      await controller.cancelled.promise;
      // Allow the router's lastValueFrom and response handling to finish too.
      await setImmediate();
      expect(errors).toEqual([]);
      const response = await fetch(url);
      expect(await response.json()).toEqual({ records: ['record'], aborted: false });
    } finally {
      client.destroy();
    }
  });

  it('retains existing HTTP error mapping for a connected SQLSTATE 57014', async () => {
    const { url, errors } = await startApp();
    const response = await fetch(`${url}/sql-error`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'sql-error' });
    expect(errors).toEqual([expect.objectContaining({ code: '57014' })]);
  });
});
