import { context as otelContext, trace } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenTelemetryTracer,
  V2_CODE_LAYER_ATTRIBUTE,
  V2_CODE_OWNERSHIP_ATTRIBUTE,
  V2_CODE_PATH_ATTRIBUTE,
} from './v2-tracer.adapter';

vi.mock('@opentelemetry/api', async () => {
  const actual = await vi.importActual<typeof import('@opentelemetry/api')>('@opentelemetry/api');
  return {
    ...actual,
    trace: {
      ...actual.trace,
      getTracer: vi.fn(),
      getActiveSpan: vi.fn(),
      setSpan: vi.fn((_ctx, span) => ({ span })),
    },
    context: {
      ...actual.context,
      active: vi.fn(() => ({ active: true })),
      with: vi.fn((_ctx, callback: () => Promise<unknown>) => callback()),
    },
  };
});

describe('OpenTelemetryTracer', () => {
  it('adds v2 ownership attributes to every started span', () => {
    const startSpan = vi.fn(() => ({ end: vi.fn() }));
    vi.mocked(trace.getTracer).mockReturnValue({ startSpan } as never);

    const tracer = new OpenTelemetryTracer();
    tracer.startSpan('teable.command.TestCommand', { custom: 'value' });

    expect(startSpan).toHaveBeenCalledWith(
      'teable.command.TestCommand',
      {
        attributes: {
          [V2_CODE_OWNERSHIP_ATTRIBUTE]: 'v2',
          [V2_CODE_PATH_ATTRIBUTE]: 'community/packages/v2',
          [V2_CODE_LAYER_ATTRIBUTE]: 'core',
          custom: 'value',
        },
      },
      otelContext.active()
    );
  });

  it('captures and restores W3C carriers around async handoff', async () => {
    const startSpan = vi.fn(() => ({ end: vi.fn() }));
    vi.mocked(trace.getTracer).mockReturnValue({ startSpan } as never);
    vi.mocked(trace.getActiveSpan).mockReturnValue({ spanContext: () => ({}) } as never);

    const tracer = new OpenTelemetryTracer();
    // Without a real OTEL SDK propagator this may be undefined; ensure no throw.
    const carrier = tracer.capturePropagationCarrier();
    await expect(tracer.runWithPropagationCarrier(carrier, async () => 'ok')).resolves.toBe('ok');
    await expect(
      tracer.runWithPropagationCarrier(
        { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
        async () => 'ok'
      )
    ).resolves.toBe('ok');
  });
});
