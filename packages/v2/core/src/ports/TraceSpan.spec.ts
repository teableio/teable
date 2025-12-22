import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../domain/shared/ActorId';
import { IExecutionContext } from './ExecutionContext';
import type { ISpan, ITracer, SpanAttributes } from './Tracer';
import { TraceSpan } from './TraceSpan';

class FakeSpan implements ISpan {
  readonly attributes: Array<[string, string | number | boolean]> = [];
  readonly errors: string[] = [];
  ended = false;

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes.push([key, value]);
  }

  setAttributes(attrs: SpanAttributes): void {
    for (const [key, value] of Object.entries(attrs)) {
      this.attributes.push([key, value]);
    }
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer implements ITracer {
  readonly spans: Array<{ name: string; attributes?: SpanAttributes; span: FakeSpan }> = [];

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    const span = new FakeSpan();
    this.spans.push({ name, attributes, span });
    return span;
  }
}

class PayloadMessage {}

class TestHandler {
  constructor(readonly tracer?: ITracer) {}

  @TraceSpan()
  async handle(
    _context: IExecutionContext,
    _message: PayloadMessage
  ): Promise<Result<string, string>> {
    return ok('ok');
  }

  @TraceSpan('custom.span', () => ({ extra: 'yes' }))
  async fail(
    _context: IExecutionContext,
    _message: PayloadMessage
  ): Promise<Result<string, string>> {
    return err('failed');
  }

  @TraceSpan()
  async crash(
    _context: IExecutionContext,
    _message: PayloadMessage
  ): Promise<Result<string, string>> {
    throw new Error('boom');
  }
}

const createContext = (tracer?: ITracer): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  if (actorIdResult.isErr()) {
    throw new Error('ActorId required');
  }
  return { actorId: actorIdResult.value, tracer };
};

describe('TraceSpan', () => {
  it('starts spans with resolved attributes', async () => {
    const tracer = new FakeTracer();
    const handler = new TestHandler();
    const context = createContext(tracer);

    const result = await handler.handle(context, new PayloadMessage());
    expect(result.isOk()).toBe(true);
    expect(tracer.spans.length).toBe(1);
    const span = tracer.spans[0];
    expect(span.name).toContain('TestHandler.handle');
    expect(span.attributes).toMatchObject({ handler: 'TestHandler', message: 'PayloadMessage' });
    expect(span.span.ended).toBe(true);
  });

  it('records errors for err results', async () => {
    const tracer = new FakeTracer();
    const handler = new TestHandler();
    const context = createContext(tracer);

    const result = await handler.fail(context, new PayloadMessage());
    expect(result.isErr()).toBe(true);
    expect(tracer.spans.length).toBe(1);
    const span = tracer.spans[0].span;
    expect(span.errors).toContain('failed');
  });

  it('records errors for thrown exceptions', async () => {
    const tracer = new FakeTracer();
    const handler = new TestHandler();
    const context = createContext(tracer);

    const result = await handler.crash(context, new PayloadMessage());
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('boom');
    }
    const span = tracer.spans[0].span;
    expect(span.errors[0]).toContain('boom');
  });

  it('falls back to noop span when tracer fails', async () => {
    const brokenTracer: ITracer = {
      startSpan() {
        throw new Error('bad tracer');
      },
    };
    const handler = new TestHandler(brokenTracer);
    const context = createContext();
    const result = await handler.handle(context, new PayloadMessage());
    expect(result.isOk()).toBe(true);
  });
});
