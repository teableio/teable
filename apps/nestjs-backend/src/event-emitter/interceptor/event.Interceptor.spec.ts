import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { EventEmitterService } from '../event-emitter.service';
import { Events } from '../events';
import { EventMiddleware } from './event.Interceptor';

const baseId = 'bseTestBaseId0001';
const spaceId = 'spcTestSpaceId001';

const run = (options: {
  declaredEvent: Events;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  resolveData?: unknown;
}) => {
  const emitAsync = vi.fn();
  const middleware = new EventMiddleware(
    { get: vi.fn(() => options.declaredEvent) } as unknown as Reflector,
    { emitAsync } as unknown as EventEmitterService
  );
  const req = {
    headers: {},
    params: options.params ?? {},
    query: {},
    body: options.body,
  } as unknown as Request;
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => vi.fn(),
  } as unknown as ExecutionContext;
  const next = { handle: () => of(options.resolveData) } as unknown as CallHandler;

  middleware.intercept(context, next).subscribe();
  return emitAsync;
};

describe('EventMiddleware', () => {
  it('emits BASE_CREATE for a template applied to a new base', () => {
    const emitAsync = run({
      declaredEvent: Events.BASE_CREATE,
      body: { spaceId, templateId: 'tplTestTemplate01' },
      resolveData: { id: baseId, name: 'From template', spaceId },
    });

    expect(emitAsync).toHaveBeenCalledWith(
      Events.BASE_CREATE,
      expect.objectContaining({ name: Events.BASE_CREATE })
    );
  });

  it('unwraps the base an import resolves to', () => {
    const emitAsync = run({
      declaredEvent: Events.BASE_CREATE,
      body: { spaceId },
      // An import returns the id maps alongside the base, not the base itself.
      resolveData: { base: { id: baseId, name: 'Imported', spaceId }, tableIdMap: {} },
    });

    expect(emitAsync).toHaveBeenCalledWith(
      Events.BASE_CREATE,
      expect.objectContaining({
        payload: { base: { id: baseId, name: 'Imported', spaceId } },
      })
    );
  });

  it('emits BASE_UPDATE when the template is applied to a base the request names', () => {
    // `create-from-template` emits BASE_CREATE either way, but naming a target base means the
    // template was applied to it — recording that as a creation would be a false audit trail.
    const emitAsync = run({
      declaredEvent: Events.BASE_CREATE,
      body: { spaceId, templateId: 'tplTestTemplate01', baseId },
      resolveData: { id: baseId, name: 'Existing base', spaceId },
    });

    expect(emitAsync).toHaveBeenCalledWith(
      Events.BASE_UPDATE,
      expect.objectContaining({
        name: Events.BASE_UPDATE,
        payload: expect.objectContaining({ base: expect.objectContaining({ id: baseId }) }),
      })
    );
  });

  it('falls back to the route param for an update that resolves to nothing', () => {
    const emitAsync = run({
      declaredEvent: Events.BASE_UPDATE,
      params: { baseId },
      body: { anchorId: 'bseAnchor00000001', position: 'after' },
      resolveData: undefined,
    });

    expect(emitAsync).toHaveBeenCalledWith(
      Events.BASE_UPDATE,
      expect.objectContaining({
        payload: {
          base: { id: baseId },
          body: { anchorId: 'bseAnchor00000001', position: 'after' },
        },
      })
    );
  });
});
