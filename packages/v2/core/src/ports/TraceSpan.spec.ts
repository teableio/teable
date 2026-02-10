import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import type { DomainError } from '../domain/shared/DomainError';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { IExecutionContext } from './ExecutionContext';
import type { ISpan, ITracer, SpanAttributes } from './Tracer';
import { TeableSpanAttributes } from './Tracer';
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
  private activeSpan: FakeSpan | undefined = undefined;

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    const span = new FakeSpan();
    this.spans.push({ name, attributes, span });
    this.activeSpan = span;
    return span;
  }

  async withSpan<T>(_span: ISpan, callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  getActiveSpan(): ISpan | undefined {
    return this.activeSpan;
  }
}

class PayloadMessage {}

class TestHandler {
  constructor(readonly tracer?: ITracer) {}

  @TraceSpan()
  async handle(
    _context: IExecutionContext,
    _message: PayloadMessage
  ): Promise<Result<string, DomainError>> {
    return ok('ok');
  }

  @TraceSpan('teable.custom.span', () => ({ extra: 'yes' }))
  async fail(
    _context: IExecutionContext,
    _message: PayloadMessage
  ): Promise<Result<string, DomainError>> {
    return err(domainError.unexpected({ message: 'failed' }));
  }

  @TraceSpan()
  async crash(
    _context: IExecutionContext,
    _message: PayloadMessage
  ): Promise<Result<string, DomainError>> {
    throw new Error('boom');
  }

  @TraceSpan()
  async throwObject(
    _context: IExecutionContext,
    _message: PayloadMessage
  ): Promise<Result<string, DomainError>> {
    throw { code: 'boom' };
  }
}

const createContext = (tracer?: ITracer): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId, tracer };
};

describe('TraceSpan', () => {
  it('starts spans with resolved attributes', async () => {
    const tracer = new FakeTracer();
    const handler = new TestHandler();
    const context = createContext(tracer);

    const result = await handler.handle(context, new PayloadMessage());
    result._unsafeUnwrap();
    expect(tracer.spans.length).toBe(1);
    const span = tracer.spans[0];
    expect(span.name).toContain('TestHandler.handle');
    expect(span.attributes).toMatchObject({
      [TeableSpanAttributes.VERSION]: 'v2',
      [TeableSpanAttributes.COMPONENT]: 'handler',
      [TeableSpanAttributes.HANDLER]: 'TestHandler',
      [TeableSpanAttributes.OPERATION]: 'TestHandler.handle',
      'teable.message': 'PayloadMessage',
    });
    expect(span.span.ended).toBe(true);
  });

  it('records errors for err results', async () => {
    const tracer = new FakeTracer();
    const handler = new TestHandler();
    const context = createContext(tracer);

    const result = await handler.fail(context, new PayloadMessage());
    result._unsafeUnwrapErr();
    expect(tracer.spans.length).toBe(1);
    const span = tracer.spans[0].span;
    expect(span.errors).toContain('failed');
  });

  it('records errors for thrown exceptions', async () => {
    const tracer = new FakeTracer();
    const handler = new TestHandler();
    const context = createContext(tracer);

    const result = await handler.crash(context, new PayloadMessage());
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('boom');
    const span = tracer.spans[0].span;
    expect(span.errors[0]).toContain('boom');
  });

  it('handles unknown payload names and non-Error throws', async () => {
    const tracer = new FakeTracer();
    const handler = new TestHandler();
    const context = createContext(tracer);

    const handleResult = await handler.handle(context, null as unknown as PayloadMessage);
    handleResult._unsafeUnwrap();
    expect(tracer.spans[0]?.attributes?.['teable.message']).toBe('unknown');

    const crashResult = await handler.throwObject(context, new PayloadMessage());
    crashResult._unsafeUnwrapErr();
    const span = tracer.spans[1]?.span;
    expect(span?.errors[0]).toContain('boom');
  });

  it('falls back to noop span when tracer fails', async () => {
    const brokenTracer: ITracer = {
      startSpan() {
        throw new Error('bad tracer');
      },
      async withSpan<T>(_span: ISpan, callback: () => Promise<T>): Promise<T> {
        return callback();
      },
      getActiveSpan(): ISpan | undefined {
        return undefined;
      },
    };
    const handler = new TestHandler(brokenTracer);
    const context = createContext();
    const result = await handler.handle(context, new PayloadMessage());
    result._unsafeUnwrap();
  });
});
